import { EventBus } from '../src/js/utils/events.js';

describe('EventBus', () => {
  test('on/emit/off basic flow', () => {
    const bus = new EventBus();
    const received = [];
    const off = bus.on('tick', (x) => received.push(x));
    bus.emit('tick', 1);
    bus.emit('tick', 2);
    off();
    bus.emit('tick', 3);
    expect(received).toEqual([1, 2]);
  });

  test('once handler only fires once', () => {
    const bus = new EventBus();
    let n = 0;
    bus.once('go', () => n++);
    bus.emit('go');
    bus.emit('go');
    expect(n).toBe(1);
  });
});

