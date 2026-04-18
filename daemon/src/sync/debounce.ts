export class DebouncedTask {
  private readonly delayMs: number;
  private readonly callback: () => Promise<void> | void;
  private timer: NodeJS.Timeout | null = null;

  public constructor(delayMs: number, callback: () => Promise<void> | void) {
    this.delayMs = delayMs;
    this.callback = callback;
  }

  public trigger(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(async () => {
      this.timer = null;
      await this.callback();
    }, this.delayMs);
  }

  public async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      await this.callback();
    }
  }
}
