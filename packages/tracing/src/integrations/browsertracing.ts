import { Hub } from '@sentry/hub';
import { Event, EventProcessor, Integration, Severity } from '@sentry/types';
import { logger, safeJoin } from '@sentry/utils';

import { IdleTransaction } from '../idletransaction';
import { SpanStatus } from '../spanstatus';

import { RoutingInstrumentationClass, TracingRouter, TracingRouterOptions } from './tracing/router';
import { Location as LocationType } from './tracing/types';

/**
 * TODO: Figure out Tracing.finishIdleTransaction()
 *  - Need beforeFinish() transaction hook here
 * TODO: Figure out both XHR and Fetch tracing
 *  - This should be a integration that just runs automatically like the router
 * TODO: _setupErrorHandling
 *  - This should be a integration that runs automatically
 * TODO: _setupBackgroundTabDetection
 *  - This something that works automatically too
 *  - This just cancels active pageload/navigation on scope
 *  - Provide option to to extend to all transactions??
 * TODO: Tracing._addPerformanceEntries
 *  - This is a beforeFinish() hook here
 */

/**
 * Options for Browser Tracing integration
 */
export type BrowserTracingOptions = {
  /**
   * List of strings / regex where the integration should create Spans out of. Additionally this will be used
   * to define which outgoing requests the `sentry-trace` header will be attached to.
   *
   * Default: ['localhost', /^\//]
   */
  tracingOrigins: Array<string | RegExp>;

  /**
   * The maximum duration of a transaction before it will be marked as "deadline_exceeded".
   * If you never want to mark a transaction set it to 0.
   * Time is in seconds.
   *
   * Default: 600
   */
  maxTransactionDuration: number;

  /**
   * This is only if you want to debug in prod.
   * writeAsBreadcrumbs: Instead of having console.log statements we log messages to breadcrumbs
   * so you can investigate whats happening in production with your users to figure why things might not appear the
   * way you expect them to.
   *
   * spanDebugTimingInfo: Add timing info to spans at the point where we create them to figure out browser timing
   * issues.
   *
   * You shouldn't care about this.
   *
   * Default: {
   *   writeAsBreadcrumbs: false;
   *   spanDebugTimingInfo: false;
   * }
   */
  debug: {
    writeAsBreadcrumbs: boolean;
    spanDebugTimingInfo: boolean;
  };

  routerTracing: RoutingInstrumentationClass;
} & TracingRouterOptions;

const defaultTracingOrigins = ['localhost', /^\//];

export class BrowserTracing implements Integration {
  /**
   * @inheritDoc
   */
  public static id: string = 'BrowserTracing';

  /**
   * @inheritDoc
   */
  public name: string = BrowserTracing.id;

  /**
   * Browser Tracing integration options
   */
  public static options: BrowserTracingOptions;

  /**
   * Returns current hub.
   */
  private static _getCurrentHub?: () => Hub;

  public constructor(_options?: Partial<BrowserTracingOptions>) {
    const routerDefaults: TracingRouterOptions = {
      beforeNavigate(location: LocationType): string | null {
        return location.pathname;
      },
      idleTimeout: 500,
      startTransactionOnLocationChange: true,
      startTransactionOnPageLoad: true,
    };

    const defaults = {
      debug: {
        spanDebugTimingInfo: false,
        writeAsBreadcrumbs: false,
      },
      markBackgroundTransactions: true,
      maxTransactionDuration: 600,
      routerTracing: TracingRouter,
      tracingOrigins: defaultTracingOrigins,
    };
    BrowserTracing.options = {
      ...routerDefaults,
      ...defaults,
      ..._options,
    };
  }

  /**
   * @inheritDoc
   */
  public setupOnce(addGlobalEventProcessor: (callback: EventProcessor) => void, getCurrentHub: () => Hub): void {
    BrowserTracing._getCurrentHub = getCurrentHub;

    const hub = getCurrentHub();

    const {
      beforeNavigate,
      idleTimeout,
      startTransactionOnLocationChange,
      startTransactionOnPageLoad,
    } = BrowserTracing.options;

    const routerTracing = new BrowserTracing.options.routerTracing({
      beforeNavigate,
      idleTimeout,
      startTransactionOnLocationChange,
      startTransactionOnPageLoad,
    });

    const beforeFinish = (transactionSpan: IdleTransaction): void => {
      // BrowserTracing._beforeFinish(transactionSpan);
    };

    routerTracing.init(hub, idleTimeout, beforeFinish);

    // This EventProcessor makes sure that the transaction is not longer than maxTransactionDuration
    addGlobalEventProcessor((event: Event) => {
      const self = getCurrentHub().getIntegration(BrowserTracing);
      if (!self) {
        return event;
      }

      const isOutdatedTransaction =
        event.timestamp &&
        event.start_timestamp &&
        (event.timestamp - event.start_timestamp > BrowserTracing.options.maxTransactionDuration ||
          event.timestamp - event.start_timestamp < 0);

      if (
        BrowserTracing.options.maxTransactionDuration !== 0 &&
        event.type === 'transaction' &&
        isOutdatedTransaction
      ) {
        BrowserTracing._log(`[Tracing] Transaction: ${SpanStatus.Cancelled} since it maxed out maxTransactionDuration`);
        if (event.contexts && event.contexts.trace) {
          event.contexts.trace = {
            ...event.contexts.trace,
            status: SpanStatus.DeadlineExceeded,
          };
          event.tags = {
            ...event.tags,
            maxTransactionDurationExceeded: 'true',
          };
        }
      }

      return event;
    });
  }

  /**
   * Called before the idle transaction finishes
   * {@see IdleTransaction.beforeFinish}
   */
  // private static _beforeFinish(transaction: IdleTransaction): void {
  //   this._checkIfOutdated;
  //   //this._addPerformanceEntries(transaction);
  // }

  /**
   * Uses logger.log to log things in the SDK or as breadcrumbs if defined in options
   */
  private static _log(...args: any[]): void {
    if (BrowserTracing.options && BrowserTracing.options.debug && BrowserTracing.options.debug.writeAsBreadcrumbs) {
      const _getCurrentHub = BrowserTracing._getCurrentHub;
      if (_getCurrentHub) {
        _getCurrentHub().addBreadcrumb({
          category: 'tracing',
          level: Severity.Debug,
          message: safeJoin(args, ' '),
          type: 'debug',
        });
      }
    }
    logger.log(...args);
  }
}
