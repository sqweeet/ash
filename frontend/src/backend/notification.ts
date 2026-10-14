import { Notify } from "../../wailsjs/go/app/App";

// Notifications use the native Ash backend (App.Notify) rather than the Wails
// runtime. The Wails runtime registers the toast under the executable's file
// name ("Ash.exe") with no app icon, which renders as a generic toast; the
// Ash backend registers a proper AppUserModelID ("Ash") with the app icon for
// a correctly branded Windows system notification.

export async function isPermissionGranted(): Promise<boolean> {
  // The Ash backend always sends natively on Windows; on mac/linux it routes
  // through the Wails runtime. There is no user-facing permission to check.
  return true;
}

export async function requestPermission(): Promise<"granted" | "denied"> {
  return "granted";
}

export async function sendNotification(opts: { title: string; body?: string }): Promise<void> {
  await Notify(opts.title, opts.body ?? "");
}
