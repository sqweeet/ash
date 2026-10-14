import { BrowserOpenURL } from "../../wailsjs/runtime";
export { OpenPath as openPath } from "../../wailsjs/go/app/Tools";

export async function openUrl(url: string): Promise<void> {
  BrowserOpenURL(url);
}
