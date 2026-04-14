import { EventEmitter } from "node:events";
import type { BaseStationOledService, OledNotificationKind } from "./service";

export type OledNotificationServiceState = "stopped" | "running";

export interface OledNotificationServiceStatus {
  state: OledNotificationServiceState;
  detail: string;
}

/**
 * Manages OLED display notifications independently from the base station display service.
 * When enabled, routes showTypedNotification / showCustomNotification calls to the
 * underlying BaseStationOledService. Disabling this service suppresses all OLED
 * notifications while leaving the dashboard display widgets unaffected.
 */
export class OledNotificationService extends EventEmitter {
  private state: OledNotificationServiceState = "stopped";
  private detail = "Stopped";
  private enabled = false;

  constructor(private readonly oledService: BaseStationOledService) {
    super();
  }

  public start(): void {
    if (this.state === "running") {
      return;
    }
    this.state = "running";
    this.detail = "Running";
    this.emit("status", "OLED notification service started.");
  }

  public stop(): void {
    if (this.state === "stopped") {
      return;
    }
    this.state = "stopped";
    this.detail = "Stopped";
    this.emit("status", "OLED notification service stopped.");
  }

  public configureRuntime(config: { enabled?: boolean }): void {
    if (config.enabled == null) {
      return;
    }
    const wasEnabled = this.enabled;
    this.enabled = config.enabled;
    if (this.enabled && !wasEnabled) {
      this.start();
    } else if (!this.enabled && wasEnabled) {
      this.stop();
    }
  }

  public getRuntimeStatus(): OledNotificationServiceStatus {
    return { state: this.state, detail: this.detail };
  }

  public showTypedNotification(
    kind: OledNotificationKind,
    title: string,
    valueText: string,
    valuePercent?: number,
  ): void {
    if (this.state !== "running") {
      return;
    }
    this.oledService.showTypedNotification(kind, title, valueText, valuePercent);
  }

  public showCustomNotification(title: string, body: string): void {
    if (this.state !== "running") {
      return;
    }
    this.oledService.showCustomNotification(title, body);
  }
}
