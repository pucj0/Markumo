export { chromium } from 'playwright'
export const browserOptions = {
  headless: true,
  ...((process.env.MARKUMO_BROWSER_CHANNEL || process.env.LIGHTEDIT_BROWSER_CHANNEL) ? { channel: process.env.MARKUMO_BROWSER_CHANNEL || process.env.LIGHTEDIT_BROWSER_CHANNEL }
    : process.platform === 'win32' ? { channel: 'msedge' } : {}),
}
