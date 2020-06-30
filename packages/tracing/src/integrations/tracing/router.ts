import { Hub } from '@sentry/hub';
import { addInstrumentationHandler, getGlobalObject, timestampWithMs } from '@sentry/utils';

import { IdleTransaction } from '../../idletransaction';
import { Transaction } from '../../transaction';

import { Location as LocationType } from './types';

const global = getGlobalObject<Window>();

/**
 * Options for TracingRouter
 */
export interface TracingRouterOptions {
  /**
   * The time to wait in ms until the transaction will be finished. The transaction will use the end timestamp of
   * the last finished span as the endtime for the transaction.
   * Time is in ms.
   *
   * Default: 500
   */
  idleTimeout: number;

  /**
   * Flag to enable/disable creation of `navigation` transaction on history changes. Useful for react applications with
   * a router.
   *
   * Default: true
   */
  startTransactionOnLocationChange: boolean;

  /**
   * Flag to enable/disable creation of `pageload` transaction on first pageload.
   *
   * Default: true
   */
  startTransactionOnPageLoad: boolean;

  /**
   * beforeNavigate is called before a pageload/navigation transaction is created and allows for users
   * to set a custom navigation transaction name based on the current `window.location`. Defaults to returning
   * `window.location.pathname`.
   *
   * If null is returned, a pageload/navigation transaction will not be created.
   *
   * @param name the current name of the pageload/navigation transaction
   */
  beforeNavigate(location: LocationType): string | null;
}

/** JSDOC */
export interface RoutingInstrumentation {
  options: Partial<TracingRouterOptions>;
  /**
   * init the routing instrumentation
   */
  init(hub: Hub, idleTimeout: number, beforeFinish?: (transactionSpan: IdleTransaction) => void): void;
}

export type RoutingInstrumentationClass = new (_options?: TracingRouterOptions) => RoutingInstrumentation;

/** JSDOC */
export class TracingRouter implements RoutingInstrumentation {
  /** JSDoc */
  public options: Partial<TracingRouterOptions> = {};

  private _activeTransaction?: IdleTransaction;

  public constructor(_options?: TracingRouterOptions) {
    if (_options) {
      this.options = _options;
    }
  }

  /** JSDOC */
  private _startIdleTransaction(hub: Hub, op: string, idleTimeout: number): IdleTransaction | undefined {
    if (!global || !global.location || !hub) {
      return undefined;
    }

    let name: string | null = window.location.pathname;
    if (this.options.beforeNavigate) {
      name = this.options.beforeNavigate(window.location);

      // if beforeNavigate returns null, we should not start a transaction.
      if (name === null) {
        return undefined;
      }
    }

    this._activeTransaction = hub.startTransaction(
      {
        name,
        op,
        trimEnd: true,
      },
      idleTimeout,
    ) as IdleTransaction;

    return this._activeTransaction;
  }

  /**
   * Start recording pageload/navigation transactions
   * @param hub The hub associated with the pageload/navigation transactions
   * @param idleTimeout The timeout for the transactions
   */
  public init(hub: Hub, idleTimeout: number, beforeFinish?: (transactionSpan: IdleTransaction) => void): void {
    if (this.options.startTransactionOnPageLoad) {
      this._activeTransaction = this._startIdleTransaction(hub, 'pageload', idleTimeout);
      if (this._activeTransaction && beforeFinish) {
        this._activeTransaction.beforeFinish(beforeFinish);
      }
    }

    addInstrumentationHandler({
      callback: () => {
        if (this.options.startTransactionOnLocationChange) {
          if (this._activeTransaction) {
            this._activeTransaction.finish(timestampWithMs());
          }
          this._activeTransaction = this._startIdleTransaction(hub, 'navigation', idleTimeout);
          if (this._activeTransaction) {
            this._activeTransaction.beforeFinish(beforeFinish);
          }
        }
      },
      type: 'history',
    });
  }
}
