import {
  BrowserClient,
  defaultIntegrations,
  defaultStackParser,
  Hub,
  makeFetchTransport,
} from '@sentry/react';

let hub: Hub | undefined;

function init(dsn: string) {
  // This client is used to track all API requests that use `app/api`
  // This is a bit noisy so we don't want it in the main project (yet)
  const client = new BrowserClient({
    dsn,
    transport: makeFetchTransport,
    stackParser: defaultStackParser,
    integrations: defaultIntegrations,
  });

  hub = new Hub(client);
}

const run: Hub['run'] = cb => {
  if (!hub) {
    return;
  }

  hub.run(cb);
};

export {init, run};
