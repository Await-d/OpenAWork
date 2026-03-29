export interface RawEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface InspectedEvent {
  type: string;
  data: unknown;
  timestamp: number;
  parsed: unknown;
  size: number;
  latency?: number;
}

export type EventSubscriber = (event: InspectedEvent) => void;

const EVENT_BUFFER_LIMIT = 500;

function parseEventData(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      return data;
    }
  }
  return data;
}

function measureSize(data: unknown): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return 0;
  }
}

export class EventStreamInspector {
  private readonly buffer: InspectedEvent[] = [];
  private readonly subscribers = new Set<EventSubscriber>();
  private lastTimestamp = 0;

  inspect(event: RawEvent): InspectedEvent {
    const parsed = parseEventData(event.data);
    const size = measureSize(event.data);
    const latency = this.lastTimestamp > 0 ? event.timestamp - this.lastTimestamp : undefined;
    this.lastTimestamp = event.timestamp;

    const inspected: InspectedEvent = {
      type: event.type,
      data: event.data,
      timestamp: event.timestamp,
      parsed,
      size,
      latency,
    };

    if (this.buffer.length >= EVENT_BUFFER_LIMIT) {
      this.buffer.shift();
    }
    this.buffer.push(inspected);

    for (const subscriber of this.subscribers) {
      subscriber(inspected);
    }

    return inspected;
  }

  subscribe(fn: EventSubscriber): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }

  getBuffer(): InspectedEvent[] {
    return [...this.buffer];
  }

  clearBuffer(): void {
    this.buffer.length = 0;
  }
}

export class DeveloperMode {
  private enabled = false;
  readonly inspector = new EventStreamInspector();

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }
}

export const developerMode = new DeveloperMode();
