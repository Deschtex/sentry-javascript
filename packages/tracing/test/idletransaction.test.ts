import { BrowserClient } from '@sentry/browser';
import { Hub } from '@sentry/hub';

import { IdleTransaction, IdleTransactionSpanRecorder } from '../src/idletransaction';
import { Span } from '../src/span';

describe('IdleTransaction', () => {
  let hub: Hub;
  beforeEach(() => {
    jest.useFakeTimers();
    hub = new Hub(new BrowserClient({ tracesSampleRate: 1 }));
  });

  it('push and pops activities', () => {
    const mockFinish = jest.fn();
    const transaction = new IdleTransaction({ name: 'foo' }, hub, 1000);
    transaction.finish = mockFinish;
    transaction.initSpanRecorder(10);
    expect(transaction.activities).toMatchObject({});

    const span = transaction.startChild();
    expect(transaction.activities).toMatchObject({ [span.spanId]: true });

    expect(mockFinish).toHaveBeenCalledTimes(0);

    span.finish();
    expect(transaction.activities).toMatchObject({});
    jest.runOnlyPendingTimers();

    expect(mockFinish).toHaveBeenCalledTimes(1);
  });

  it('does not finish if there are still active activities', () => {
    const mockFinish = jest.fn();
    const transaction = new IdleTransaction({ name: 'foo' }, hub, 1000);

    transaction.finish = mockFinish;
    transaction.initSpanRecorder(10);
    expect(transaction.activities).toMatchObject({});

    const span = transaction.startChild();
    const childSpan = span.startChild();

    expect(transaction.activities).toMatchObject({ [span.spanId]: true, [childSpan.spanId]: true });
    span.finish();
    jest.runOnlyPendingTimers();

    expect(mockFinish).toHaveBeenCalledTimes(0);
    expect(transaction.activities).toMatchObject({ [childSpan.spanId]: true });
  });

  describe('heartbeat', () => {
    it('finishes a transaction after 3 beats', () => {
      const mockFinish = jest.fn();
      const transaction = new IdleTransaction({ name: 'foo' }, hub, 1000);
      transaction.finish = mockFinish;
      transaction.initSpanRecorder(10);

      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 1
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 2
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 3
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(1);
    });

    it('resets after new activities are added', () => {
      const mockFinish = jest.fn();
      const transaction = new IdleTransaction({ name: 'foo' }, hub, 1000);
      transaction.finish = mockFinish;
      transaction.initSpanRecorder(10);

      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 1
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      const span = transaction.startChild(); // push activity

      // Beat 1
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 2
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      transaction.startChild(); // push activity
      transaction.startChild(); // push activity

      // Beat 1
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 2
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      span.finish(); // pop activity

      // Beat 1
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 2
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(0);

      // Beat 3
      jest.runOnlyPendingTimers();
      expect(mockFinish).toHaveBeenCalledTimes(1);
    });
  });
});

describe('IdleTransactionSpanRecorder', () => {
  it('pushes and pops activities', () => {
    const mockPushActivity = jest.fn();
    const mockPopActivity = jest.fn();

    const spanRecorder = new IdleTransactionSpanRecorder(10, mockPushActivity, mockPopActivity);
    expect(mockPushActivity).toHaveBeenCalledTimes(0);
    expect(mockPopActivity).toHaveBeenCalledTimes(0);

    const span = new Span({ sampled: true });

    expect(spanRecorder.spans).toHaveLength(0);
    spanRecorder.add(span);
    expect(spanRecorder.spans).toHaveLength(1);

    expect(mockPushActivity).toHaveBeenCalledTimes(1);
    expect(mockPushActivity).toHaveBeenLastCalledWith(span.spanId);
    expect(mockPopActivity).toHaveBeenCalledTimes(0);

    span.finish();
    expect(mockPushActivity).toHaveBeenCalledTimes(1);
    expect(mockPopActivity).toHaveBeenCalledTimes(1);
    expect(mockPushActivity).toHaveBeenLastCalledWith(span.spanId);
  });
});
