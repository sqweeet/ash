import { EventsOn } from "../../wailsjs/runtime";

export function listen<T>(name: string, handler: (event: { payload: T }) => void): Promise<() => void> {
  return Promise.resolve(EventsOn(name, (payload: T) => handler({ payload })));
}
