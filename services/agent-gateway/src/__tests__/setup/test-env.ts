if (!process.env['DATABASE_URL'] && !process.env['OPENAWORK_DATABASE_PATH']) {
  process.env['DATABASE_URL'] = ':memory:';
}

if (!process.env['OPENAWORK_APP_VERSION']) {
  process.env['OPENAWORK_APP_VERSION'] = '0.0.0-test';
}
