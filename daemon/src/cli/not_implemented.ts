export function notImplemented(commandName: string): void {
  console.error(`${commandName} is not implemented in the foundation build yet.`);
  process.exitCode = 1;
}
