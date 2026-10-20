//! Bounded fetching of remote images used by DOCX export.
//!
//! The policy is enforced on the address that is actually connected to, not on
//! the URL text: every hop is resolved once, all answers must be allowed, the
//! validated socket addresses are pinned into the HTTP client, proxies and
//! automatic redirects are disabled, and every redirect is re-validated.
use super::{Operation, Result};
use reqwest::blocking::Client;
use std::{
    io::{self, Read},
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    sync::Once,
    time::{Duration, Instant},
};
use url::{Host, Url};

const MAX_REDIRECTS: usize = 4;
const MAX_IMAGE_BYTES: usize = 4 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) fn fetch_remote_image(op: &Operation, source: &str) -> Result<Vec<u8>> {
    ensure_crypto_provider();
    fetch_with(
        source,
        op.deadline,
        &|| op.check(),
        &SystemResolver,
        &ReqwestTransport,
    )
}

fn ensure_crypto_provider() {
    static INSTALL: Once = Once::new();
    INSTALL.call_once(|| {
        if rustls::crypto::CryptoProvider::get_default().is_none() {
            let _ = rustls::crypto::ring::default_provider().install_default();
        }
    });
}

trait Resolver {
    fn resolve(&self, host: &str, port: u16) -> io::Result<Vec<SocketAddr>>;
}

struct SystemResolver;
impl Resolver for SystemResolver {
    fn resolve(&self, host: &str, port: u16) -> io::Result<Vec<SocketAddr>> {
        (host, port).to_socket_addrs().map(|addrs| addrs.collect())
    }
}

struct Response {
    status: u16,
    location: Option<String>,
    body: Vec<u8>,
}

trait Transport {
    fn get(&self, url: &Url, pinned: &[SocketAddr], timeout: Duration) -> Result<Response>;
}

struct ReqwestTransport;
impl Transport for ReqwestTransport {
    fn get(&self, url: &Url, pinned: &[SocketAddr], timeout: Duration) -> Result<Response> {
        let mut builder = Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            // An environment/system proxy would fetch the address itself and
            // bypass the pinned, validated destination.
            .no_proxy();
        if let Some(Host::Domain(host)) = url.host() {
            builder = builder.resolve_to_addrs(host, pinned);
        }
        let client = builder
            .build()
            .map_err(|e| format!("初始化 Word 网络图片请求失败: {e}"))?;
        let response = client
            .get(url.clone())
            .send()
            .map_err(|e| format!("读取 Word 网络图片失败: {e}"))?;
        let status = response.status().as_u16();
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .map(|value| {
                value
                    .to_str()
                    .map(str::to_owned)
                    .map_err(|_| "Word 网络图片重定向目标无效".to_string())
            })
            .transpose()?;
        if !(200..=299).contains(&status) {
            return Ok(Response {
                status,
                location,
                body: Vec::new(),
            });
        }
        let mut body = Vec::new();
        response
            .take(MAX_IMAGE_BYTES as u64 + 1)
            .read_to_end(&mut body)
            .map_err(|e| e.to_string())?;
        Ok(Response {
            status,
            location,
            body,
        })
    }
}

fn fetch_with(
    source: &str,
    deadline: Instant,
    check: &dyn Fn() -> Result<()>,
    resolver: &dyn Resolver,
    transport: &dyn Transport,
) -> Result<Vec<u8>> {
    let mut url = parse_remote_url(source)?;
    for redirect in 0..=MAX_REDIRECTS {
        check()?;
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("转换超时（90 秒）".into());
        }
        let pinned = resolve_public(&url, resolver)?;
        let response = transport.get(&url, &pinned, remaining.min(REQUEST_TIMEOUT))?;
        if (300..=399).contains(&response.status) {
            if redirect == MAX_REDIRECTS {
                return Err("Word 网络图片重定向次数过多".into());
            }
            let location = response.location.ok_or("Word 网络图片重定向缺少目标")?;
            let next = url
                .join(&location)
                .map_err(|_| "Word 网络图片重定向目标无效".to_string())?;
            url = parse_remote_url(next.as_str())?;
            continue;
        }
        if !(200..=299).contains(&response.status) {
            return Err(format!("读取 Word 网络图片失败: HTTP {}", response.status));
        }
        if response.body.len() > MAX_IMAGE_BYTES {
            return Err("Word 单张网络图片超过 4 MiB".into());
        }
        return Ok(response.body);
    }
    Err("Word 网络图片重定向次数过多".into())
}

fn parse_remote_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| "无效的 Word 网络图片地址".to_string())?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Word 网络图片只允许 HTTP(S) 地址".into());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Word 网络图片不允许包含账号信息".into());
    }
    if url.host().is_none() {
        return Err("Word 网络图片缺少主机名".into());
    }
    Ok(url)
}

fn resolve_public(url: &Url, resolver: &dyn Resolver) -> Result<Vec<SocketAddr>> {
    let port = url.port_or_known_default().ok_or("Word 网络图片缺少端口")?;
    let addresses = match url.host() {
        Some(Host::Ipv4(ip)) => vec![SocketAddr::new(IpAddr::V4(ip), port)],
        Some(Host::Ipv6(ip)) => vec![SocketAddr::new(IpAddr::V6(ip), port)],
        Some(Host::Domain(host)) => {
            if forbidden_hostname(host) {
                return Err("Word 网络图片不允许访问本机或内部域名".into());
            }
            resolver
                .resolve(host, port)
                .map_err(|e| format!("无法解析 Word 网络图片域名: {e}"))?
        }
        None => return Err("Word 网络图片缺少主机名".into()),
    };
    if addresses.is_empty() {
        return Err("Word 网络图片域名没有可用地址".into());
    }
    let mut pinned = Vec::with_capacity(addresses.len());
    for address in addresses {
        if !allowed_address(address.ip()) {
            return Err(format!("Word 网络图片地址不允许访问: {}", address.ip()));
        }
        pinned.push(address);
    }
    Ok(pinned)
}

fn forbidden_hostname(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".home.arpa")
}

fn allowed_address(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => allowed_ipv4(ip),
        IpAddr::V6(ip) => allowed_ipv6(ip),
    }
}

fn allowed_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || a == 0
        || (a == 100 && (b & 0xc0) == 64)
        || (a == 192 && b == 0 && c == 0)
        || (a == 192 && b == 0 && c == 2)
        || (a == 192 && b == 88 && c == 99)
        // 198.18.0.0/15 is a benchmarking range, but fake-IP DNS proxies
        // (common on desktop VPNs) hand it out for every public host. Blocking
        // it would reject legitimate public HTTPS images there. It is not an
        // internal/link-local range, so the internal-target policy is unchanged.
        || (a == 198 && b == 51 && c == 100)
        || (a == 203 && b == 0 && c == 113)
        || a >= 240)
}

fn allowed_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(mapped) = ip.to_ipv4_mapped() {
        return allowed_ipv4(mapped);
    }
    let [a, b, ..] = ip.segments();
    if ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() {
        return false;
    }
    // Link-local and unique-local are outside 2000::/3, keep the explicit
    // checks for clarity.
    if (a & 0xffc0) == 0xfe80 || (a & 0xfe00) == 0xfc00 || (a & 0xffc0) == 0xfec0 {
        return false;
    }
    if (a & 0xe000) != 0x2000 {
        return false;
    }
    // 2001::/23 (Teredo, ORCHID, protocol assignments), 2001:db8::/32,
    // 2002::/16 (6to4 embeds IPv4) and 3fff::/20 (documentation).
    if a == 0x2001 && (b < 0x0200 || b == 0x0db8) {
        return false;
    }
    !(a == 0x2002 || (a == 0x3fff && (b & 0xf000) == 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::VecDeque, sync::Mutex};

    const PUBLIC: Ipv4Addr = Ipv4Addr::new(93, 184, 216, 34);

    struct FakeResolver {
        answers: Mutex<VecDeque<Vec<IpAddr>>>,
        calls: Mutex<Vec<(String, u16)>>,
    }
    impl FakeResolver {
        fn new(answers: Vec<Vec<IpAddr>>) -> Self {
            Self {
                answers: Mutex::new(answers.into()),
                calls: Mutex::new(Vec::new()),
            }
        }
    }
    impl Resolver for FakeResolver {
        fn resolve(&self, host: &str, port: u16) -> io::Result<Vec<SocketAddr>> {
            self.calls.lock().unwrap().push((host.into(), port));
            Ok(self
                .answers
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_default()
                .into_iter()
                .map(|ip| SocketAddr::new(ip, port))
                .collect())
        }
    }

    struct FakeTransport {
        responses: Mutex<VecDeque<Response>>,
        calls: Mutex<Vec<(String, Vec<SocketAddr>)>>,
    }
    impl FakeTransport {
        fn new(responses: Vec<Response>) -> Self {
            Self {
                responses: Mutex::new(responses.into()),
                calls: Mutex::new(Vec::new()),
            }
        }
    }
    impl Transport for FakeTransport {
        fn get(&self, url: &Url, pinned: &[SocketAddr], _timeout: Duration) -> Result<Response> {
            self.calls
                .lock()
                .unwrap()
                .push((url.to_string(), pinned.to_vec()));
            self.responses
                .lock()
                .unwrap()
                .pop_front()
                .ok_or_else(|| "unexpected transport call".into())
        }
    }

    fn run(source: &str, resolver: &FakeResolver, transport: &FakeTransport) -> Result<Vec<u8>> {
        fetch_with(
            source,
            Instant::now() + Duration::from_secs(60),
            &|| Ok(()),
            resolver,
            transport,
        )
    }
    fn ok(body: &[u8]) -> Response {
        Response {
            status: 200,
            location: None,
            body: body.to_vec(),
        }
    }
    fn redirect(location: &str) -> Response {
        Response {
            status: 302,
            location: Some(location.into()),
            body: Vec::new(),
        }
    }

    #[test]
    fn private_and_special_ipv4_targets_are_rejected() {
        for ip in [
            "127.0.0.1",
            "127.255.255.254",
            "10.0.0.1",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "0.1.2.3",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "240.0.0.1",
            "255.255.255.255",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(!allowed_address(ip), "{ip} must not be treated as public");
        }
        for ip in [
            "1.1.1.1",
            "8.8.8.8",
            "93.184.216.34",
            "172.32.0.1",
            "192.169.0.1",
            "198.18.0.1",
            "203.0.114.1",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(allowed_address(ip), "{ip} must remain reachable");
        }
    }

    #[test]
    fn private_and_special_ipv6_targets_are_rejected() {
        for ip in [
            "::",
            "::1",
            "fe80::1",
            "fc00::1",
            "fd12::1",
            "fec0::1",
            "ff02::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "2001:db8::1",
            "2001::1",
            "2001:20::1",
            "2002:7f00:1::",
            "3fff::1",
            "64:ff9b::7f00:1",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(!allowed_address(ip), "{ip} must not be treated as public");
        }
        for ip in [
            "2606:4700:4700::1111",
            "2001:4860:4860::8888",
            "2a00:1450:4001:81b::200e",
            "::ffff:8.8.8.8",
        ] {
            let ip: IpAddr = ip.parse().unwrap();
            assert!(allowed_address(ip), "{ip} must remain reachable");
        }
    }

    #[test]
    fn only_http_s_without_credentials_is_accepted() {
        for source in [
            "file:///C:/Windows/win.ini",
            "ftp://example.com/a.png",
            "javascript:alert(1)",
            "http://user:pass@example.com/a.png",
        ] {
            assert!(parse_remote_url(source).is_err(), "{source}");
        }
        assert!(parse_remote_url("http://example.com/a.png?x=@evil").is_ok());
        assert!(forbidden_hostname("localhost"));
        assert!(forbidden_hostname("api.localhost"));
        assert!(forbidden_hostname("printer.local"));
        assert!(forbidden_hostname("metadata.internal"));
        assert!(forbidden_hostname("router.home.arpa"));
        assert!(!forbidden_hostname("localhost.example.com"));
    }

    #[test]
    fn loopback_and_metadata_ip_literals_never_reach_the_transport() {
        for source in [
            "http://127.0.0.1:8080/a.png",
            "http://[::1]:8080/a.png",
            "http://169.254.169.254/latest/meta-data/",
            "http://[::ffff:127.0.0.1]/a.png",
        ] {
            let resolver = FakeResolver::new(Vec::new());
            let transport = FakeTransport::new(Vec::new());
            let error = run(source, &resolver, &transport).unwrap_err();
            assert!(error.contains("不允许"), "{source}: {error}");
            assert!(transport.calls.lock().unwrap().is_empty(), "{source}");
        }
    }

    #[test]
    fn private_dns_answers_are_rejected_before_connect() {
        for answer in [
            vec![IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))],
            vec![IpAddr::V4(Ipv4Addr::new(10, 1, 2, 3))],
            vec![IpAddr::V6("::1".parse::<Ipv6Addr>().unwrap())],
            vec![
                IpAddr::V4(PUBLIC),
                IpAddr::V4(Ipv4Addr::new(192, 168, 0, 1)),
            ],
        ] {
            let resolver = FakeResolver::new(vec![answer]);
            let transport = FakeTransport::new(Vec::new());
            assert!(run("https://images.example/a.png", &resolver, &transport).is_err());
            assert!(transport.calls.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn redirect_to_loopback_or_metadata_is_rejected_each_hop() {
        for location in [
            "http://127.0.0.1:9000/secret.png",
            "http://[::1]/secret.png",
            "http://169.254.169.254/latest/meta-data/",
            "file:///C:/Windows/win.ini",
            "https://user:pass@images.example/secret.png",
        ] {
            let resolver = FakeResolver::new(vec![vec![IpAddr::V4(PUBLIC)]]);
            let transport = FakeTransport::new(vec![redirect(location)]);
            assert!(
                run("https://images.example/start", &resolver, &transport).is_err(),
                "{location}"
            );
            assert_eq!(transport.calls.lock().unwrap().len(), 1);
        }
    }

    #[test]
    fn relative_redirect_stays_pinned_and_bounded() {
        let resolver = FakeResolver::new(vec![vec![IpAddr::V4(PUBLIC)], vec![IpAddr::V4(PUBLIC)]]);
        let transport = FakeTransport::new(vec![redirect("/next.png"), ok(b"\x89PNG body")]);
        let body = run("https://images.example/start", &resolver, &transport).unwrap();
        assert_eq!(body, b"\x89PNG body");
        let calls = transport.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].1, vec![SocketAddr::new(IpAddr::V4(PUBLIC), 443)]);
        assert_eq!(calls[1].1, vec![SocketAddr::new(IpAddr::V4(PUBLIC), 443)]);
        assert_eq!(calls[1].0, "https://images.example/next.png");
        assert_eq!(resolver.calls.lock().unwrap().len(), 2);
    }

    #[test]
    fn redirect_limit_and_size_limit_are_enforced() {
        let resolver = FakeResolver::new((0..8).map(|_| vec![IpAddr::V4(PUBLIC)]).collect());
        let transport = FakeTransport::new((0..8).map(|_| redirect("/loop")).collect());
        assert!(run("https://images.example/start", &resolver, &transport).is_err());
        assert_eq!(transport.calls.lock().unwrap().len(), MAX_REDIRECTS + 1);

        let resolver = FakeResolver::new(vec![vec![IpAddr::V4(PUBLIC)]]);
        let transport = FakeTransport::new(vec![ok(&vec![0; MAX_IMAGE_BYTES + 1])]);
        assert!(run("https://images.example/big.png", &resolver, &transport).is_err());
    }

    #[test]
    fn dns_change_between_hops_is_detected_before_connect() {
        let resolver = FakeResolver::new(vec![
            vec![IpAddr::V4(PUBLIC)],
            vec![IpAddr::V4(Ipv4Addr::new(10, 0, 0, 8))],
        ]);
        let transport = FakeTransport::new(vec![redirect("/next.png")]);
        assert!(run("https://images.example/start", &resolver, &transport).is_err());
        assert_eq!(transport.calls.lock().unwrap().len(), 1);
        assert_eq!(resolver.calls.lock().unwrap().len(), 2);
    }

    #[test]
    fn every_answer_is_validated_and_pinned_including_alternate_addresses() {
        let alternate = Ipv4Addr::new(1, 1, 1, 1);
        let resolver = FakeResolver::new(vec![vec![IpAddr::V4(PUBLIC), IpAddr::V4(alternate)]]);
        let transport = FakeTransport::new(vec![ok(b"image")]);
        run("https://images.example/a.png", &resolver, &transport).unwrap();
        let calls = transport.calls.lock().unwrap();
        assert_eq!(
            calls[0].1,
            vec![
                SocketAddr::new(IpAddr::V4(PUBLIC), 443),
                SocketAddr::new(IpAddr::V4(alternate), 443)
            ]
        );
        assert_eq!(resolver.calls.lock().unwrap()[0].0, "images.example");
        // One validated address set per request: a later DNS change cannot
        // redirect the already pinned connection.
        assert_eq!(resolver.calls.lock().unwrap().len(), 1);
    }

    #[test]
    fn cross_host_redirect_is_re_resolved_and_repinned() {
        let cdn = Ipv4Addr::new(8, 8, 8, 8);
        let resolver = FakeResolver::new(vec![vec![IpAddr::V4(PUBLIC)], vec![IpAddr::V4(cdn)]]);
        let transport =
            FakeTransport::new(vec![redirect("https://cdn.example/next.png"), ok(b"image")]);
        run("https://images.example/start", &resolver, &transport).unwrap();
        let calls = transport.calls.lock().unwrap();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].0, "https://cdn.example/next.png");
        assert_eq!(calls[1].1, vec![SocketAddr::new(IpAddr::V4(cdn), 443)]);
        let resolver_calls = resolver.calls.lock().unwrap();
        assert_eq!(resolver_calls[0].0, "images.example");
        assert_eq!(resolver_calls[1].0, "cdn.example");
    }

    #[test]
    #[ignore = "requires public network access"]
    fn public_https_image_remains_compatible() {
        ensure_crypto_provider();
        let body = fetch_with(
            "https://httpbin.org/image/png",
            Instant::now() + Duration::from_secs(30),
            &|| Ok(()),
            &SystemResolver,
            &ReqwestTransport,
        )
        .unwrap();
        assert!(body.starts_with(b"\x89PNG\r\n\x1a\n"));
    }
}
