//! Bounded structural ClassFile inspection. No VM, class loading or execution.
//! Format: https://docs.oracle.com/javase/specs/jvms/se25/html/jvms-4.html
use super::{fail, FileError, Result};
use serde::Serialize;

pub const MAGIC: &[u8] = &[0xca, 0xfe, 0xba, 0xbe];
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClassInfo {
    pub class_name: String,
    pub super_name: Option<String>,
    pub major_version: u16,
    pub minor_version: u16,
    pub access_flags: u16,
    pub byte_length: usize,
    pub constant_pool_count: usize,
    pub constants: Vec<ConstantInfo>,
    pub fields_count: u16,
    pub methods_count: u16,
    pub fields: Vec<MemberInfo>,
    pub methods: Vec<MemberInfo>,
    pub interfaces: Vec<String>,
    pub display_truncated: bool,
}
#[derive(Debug, Serialize)]
pub struct ConstantInfo { pub index: usize, pub tag: String, pub value: String }
#[derive(Debug, Serialize)]
pub struct MemberInfo { pub name: String, pub descriptor: String, pub flags: u16 }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HexPage { pub offset: usize, pub total_length: usize, pub next_offset: Option<usize>, pub text: String }

struct Reader<'a> { bytes: &'a [u8], position: usize }
impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8]> {
        let end = self.position.checked_add(count).ok_or_else(|| FileError::new("class_file", "ClassFile 长度溢出。"))?;
        let value = self.bytes.get(self.position..end).ok_or_else(|| FileError::new("class_file", &format!("ClassFile 已截断或长度损坏（偏移 0x{:X}）。", self.position)))?;
        self.position = end; Ok(value)
    }
    fn u1(&mut self) -> Result<u8> { Ok(self.take(1)?[0]) }
    fn u2(&mut self) -> Result<u16> { let b = self.take(2)?; Ok(u16::from_be_bytes([b[0],b[1]])) }
    fn u4(&mut self) -> Result<u32> { let b = self.take(4)?; Ok(u32::from_be_bytes([b[0],b[1],b[2],b[3]])) }
}
#[derive(Debug)]
enum Constant { Hole, Utf8(String), Single(u8,u16), Pair(u8,u16,u16), Bits(u8,u64), Handle(u8,u16) }
impl Constant {
    fn tag(&self) -> u8 { match self { Self::Hole=>0, Self::Utf8(_)=>1, Self::Single(t,_)|Self::Pair(t,_,_)|Self::Bits(t,_)=>*t, Self::Handle(_,_)=>15 } }
}
fn entry(pool: &[Constant], index: u16) -> Result<&Constant> {
    pool.get(index as usize).filter(|value| value.tag() != 0).ok_or_else(|| FileError::new("class_file", &format!("ClassFile 常量池索引 #{index} 无效。")))
}
fn require(pool: &[Constant], index: u16, tags: &[u8]) -> Result<()> {
    if tags.contains(&entry(pool,index)?.tag()) { Ok(()) } else { fail("class_file", "ClassFile 常量池引用类型不匹配。") }
}
fn utf8(pool: &[Constant], index: u16) -> Result<&str> {
    match entry(pool,index)? { Constant::Utf8(value) => Ok(value), _=>fail("class_file", "ClassFile 字符串索引不是 CONSTANT_Utf8。") }
}
fn class_name(pool: &[Constant], index: u16) -> Result<String> {
    match entry(pool,index)? { Constant::Single(7,name)=>Ok(utf8(pool,*name)?.replace('/',".")), _=>fail("class_file", "ClassFile 类索引不是 CONSTANT_Class。") }
}
fn clip(value: &str, limit: usize) -> String {
    let mut chars = value.chars(); let mut result: String = chars.by_ref().take(limit).collect();
    if chars.next().is_some() { result.push('…'); } result
}
// ClassFile uses modified UTF-8, including C0 80 NUL and UTF-16 surrogate pairs.
fn modified_utf8(bytes: &[u8]) -> Result<String> {
    let mut units = Vec::new(); let mut i = 0;
    while i < bytes.len() {
        let first = bytes[i]; i += 1;
        let unit = if (1..=0x7f).contains(&first) { first as u16 }
        else if first & 0xe0 == 0xc0 {
            let b = *bytes.get(i).ok_or_else(|| FileError::new("class_file", "ClassFile modified UTF-8 已截断。"))?; i += 1;
            let value = (((first & 0x1f) as u16) << 6) | (b & 0x3f) as u16;
            if b & 0xc0 != 0x80 || (value < 0x80 && value != 0) { return fail("class_file", "ClassFile modified UTF-8 无效。"); } value
        } else if first & 0xf0 == 0xe0 {
            let b = *bytes.get(i).ok_or_else(|| FileError::new("class_file", "ClassFile modified UTF-8 已截断。"))?;
            let c = *bytes.get(i+1).ok_or_else(|| FileError::new("class_file", "ClassFile modified UTF-8 已截断。"))?; i += 2;
            let value = (((first & 15) as u16) << 12) | (((b & 63) as u16) << 6) | (c & 63) as u16;
            if b & 0xc0 != 0x80 || c & 0xc0 != 0x80 || value < 0x800 { return fail("class_file", "ClassFile modified UTF-8 无效。"); } value
        } else { return fail("class_file", "ClassFile modified UTF-8 无效（不是普通 UTF-8）。"); };
        units.push(unit)
    }
    let mut output = String::new();
    for ch in char::decode_utf16(units) { match ch { Ok(ch)=>output.push(ch), Err(ch)=>output.push_str(&format!("\\u{:04X}",ch.unpaired_surrogate())) } }
    Ok(output)
}
fn attributes(reader: &mut Reader<'_>, pool: &[Constant]) -> Result<()> {
    for _ in 0..reader.u2()? { utf8(pool,reader.u2()?)?; let length = reader.u4()?; reader.take(length as usize)?; }
    Ok(())
}
fn members(reader: &mut Reader<'_>, pool: &[Constant]) -> Result<(u16,Vec<MemberInfo>)> {
    let count = reader.u2()?; let mut members = Vec::new();
    for index in 0..count {
        let flags = reader.u2()?;
        let name = utf8(pool,reader.u2()?)?; let descriptor = utf8(pool,reader.u2()?)?;
        if index < 1000 { members.push(MemberInfo { name:clip(name,300), descriptor:clip(descriptor,300), flags }); }
        attributes(reader,pool)?;
    }
    Ok((count,members))
}
pub fn parse(bytes: &[u8]) -> Result<ClassInfo> {
    let mut reader = Reader { bytes, position:0 };
    if reader.take(4)? != MAGIC { return fail("class_file", "不是 JVM ClassFile：缺少 CAFEBABE 魔数。"); }
    let minor_version = reader.u2()?; let major_version = reader.u2()?;
    if major_version < 45 || (major_version >= 56 && minor_version != 0 && minor_version != 65535) { return fail("class_file", "ClassFile 版本字段无效。"); }
    let count = reader.u2()? as usize;
    if count == 0 { return fail("class_file", "ClassFile 常量池计数不能为零。"); }
    let mut pool = vec![Constant::Hole];
    while pool.len() < count {
        let tag = reader.u1()?;
        let value = match tag {
            1=> { let length = reader.u2()?; Constant::Utf8(modified_utf8(reader.take(length as usize)?)?) },
            3|4=>Constant::Bits(tag,reader.u4()? as u64),
            5|6=>Constant::Bits(tag,((reader.u4()? as u64)<<32)|reader.u4()? as u64),
            7|8|16|19|20=>Constant::Single(tag,reader.u2()?),
            9|10|11|12|17|18=>Constant::Pair(tag,reader.u2()?,reader.u2()?),
            15=>Constant::Handle(reader.u1()?,reader.u2()?),
            _=>return fail("class_file", &format!("ClassFile 不支持或损坏的常量池标签 {tag}。")),
        };
        pool.push(value);
        if tag == 5 || tag == 6 {
            if pool.len() >= count { return fail("class_file", "ClassFile Long/Double 缺少第二个常量池位置。"); }
            pool.push(Constant::Hole);
        }
    }
    for value in &pool {
        match value {
            Constant::Single(_,index)=>require(&pool,*index,&[1])?,
            Constant::Pair(9|10|11,class,name)=>{ require(&pool,*class,&[7])?; require(&pool,*name,&[12])?; },
            Constant::Pair(12,name,descriptor)=>{ require(&pool,*name,&[1])?; require(&pool,*descriptor,&[1])?; },
            Constant::Pair(17|18,_,name)=>require(&pool,*name,&[12])?,
            Constant::Handle(kind,index)=>{
                let tags: &[u8] = match kind { 1..=4=>&[9],5|8=>&[10],6|7 if major_version>=52=>&[10,11],6|7=>&[10],9=>&[11],_=>return fail("class_file", "ClassFile MethodHandle reference_kind 无效。") };
                require(&pool,*index,tags)?;
            },
            _=>{},
        }
    }
    let access_flags = reader.u2()?; let class_name = class_name(&pool,reader.u2()?)?;
    let super_index = reader.u2()?; let super_name = if super_index==0 {None} else {Some(self::class_name(&pool,super_index)?)};
    let interfaces_count = reader.u2()?; let mut interfaces = Vec::new();
    for index in 0..interfaces_count { let name = self::class_name(&pool,reader.u2()?)?; if index<256 { interfaces.push(clip(&name,300)); } }
    let (fields_count,fields)=members(&mut reader,&pool)?; let (methods_count,methods)=members(&mut reader,&pool)?;
    attributes(&mut reader,&pool)?;
    if reader.position != bytes.len() { return fail("class_file", "ClassFile 结构结束后存在多余字节，文件可能损坏。"); }
    let mut constants = Vec::new();
    for (index,value) in pool.iter().enumerate().skip(1).take(1000) {
        let (tag,description) = match value {
            Constant::Hole=>continue,
            Constant::Utf8(s)=>("Utf8",clip(s,160)),
            Constant::Single(tag,index)=>(match tag {7=>"Class",8=>"String",16=>"MethodType",19=>"Module",_=>"Package"},format!("#{index} {}",clip(utf8(&pool,*index)?,160))),
            Constant::Pair(tag,a,b)=>(match tag {9=>"Fieldref",10=>"Methodref",11=>"InterfaceMethodref",12=>"NameAndType",17=>"Dynamic",_=>"InvokeDynamic"},format!("#{a}, #{b}")),
            Constant::Bits(tag,bits)=>(match tag {3=>"Integer",4=>"Float",5=>"Long",_=>"Double"},match tag {3=>(*bits as u32 as i32).to_string(),4=>f32::from_bits(*bits as u32).to_string(),5=>(*bits as i64).to_string(),_=>f64::from_bits(*bits).to_string()}),
            Constant::Handle(kind,index)=>("MethodHandle",format!("kind {kind}, #{index}")),
        };
        constants.push(ConstantInfo {index,tag:tag.into(),value:description});
    }
    Ok(ClassInfo {class_name,super_name,major_version,minor_version,access_flags,byte_length:bytes.len(),constant_pool_count:count-1,constants,fields_count,methods_count,fields,methods,interfaces,display_truncated:count>1001||fields_count>1000||methods_count>1000||interfaces_count>256})
}
pub fn hex_page(bytes: &[u8], offset: usize) -> Result<HexPage> {
    if offset > bytes.len() || offset % 16 != 0 { return fail("range", "十六进制偏移必须在文件范围内并对齐16字节。"); }
    let end = (offset+4096).min(bytes.len()); let mut text = String::new();
    for (line,chunk) in bytes[offset..end].chunks(16).enumerate() {
        text.push_str(&format!("{:08X}  ",offset+line*16));
        for i in 0..16 { if let Some(byte)=chunk.get(i) {text.push_str(&format!("{byte:02X} "));} else {text.push_str("   ");} }
        text.push_str(" |");
        for byte in chunk { text.push(if (32..=126).contains(byte) {*byte as char} else {'.'}); }
        text.push_str("|\n");
    }
    Ok(HexPage {offset,total_length:bytes.len(),next_offset:if end<bytes.len() {Some(end)} else {None},text})
}
