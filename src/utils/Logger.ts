import { ILogObj, Logger } from "tslog";

export function createLogger(name: string): Logger<ILogObj> {
  return new Logger({
    name,
    minLevel: process.env.NODE_ENV === "production" ? 3 : 0,
    type: "pretty",
    prettyLogTemplate: "{{yyyy}}.{{mm}}.{{dd}} {{hh}}:{{MM}}:{{ss}}:{{ms}} {{logLevelName}} [bun-tasks/{{name}}] ",
  });
}
