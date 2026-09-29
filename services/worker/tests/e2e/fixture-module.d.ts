// The browser-test seed script aliases this to the fixture it writes for each run.
declare module '@flarewatch/e2e-hub-fixture' {
  const fixture: import('./hub-fixture').HubFixture;
  export default fixture;
}
