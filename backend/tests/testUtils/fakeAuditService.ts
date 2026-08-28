import type { AuditEvent, AuditService } from "../../src/modules/audit/audit.service";

export class FakeAuditService implements AuditService {
  events: AuditEvent[] = [];

  async record(event: AuditEvent) {
    this.events.push(event);
  }
}
