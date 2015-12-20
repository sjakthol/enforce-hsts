const { Cu, Ci, Cc } = require("chrome");

const { Enforcer } = require("../lib/enforcer");
const sss = Cc["@mozilla.org/ssservice;1"]
             .getService(Ci.nsISiteSecurityService);

/**
 * Asserts that the internal STS state for the given hosts and its subdomains
 * is correct.
 *
 * @param {Object} assert
 *        The assert object for the test.
 * @param {String} host
 *        The host to check.
 * @param {Boolean} secure
 *        True if the exact host should have STS enabled, false otherwise.
 * @param {Boolean} includeSubdomains
 *        True if the subdomains should have STS enabled, false otherwise.
 */
function assertIsSecureUri(assert, host, secure, includeSubdomains) {
  let enforcePub = sss.isSecureHost(sss.HEADER_HSTS, host, 0);
  let enforcePriv = sss.isSecureHost(sss.HEADER_HSTS, host,
                                     Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.equal(enforcePub, secure, "STS correct for public contexts");
  assert.equal(enforcePriv, secure, "STS correct for private contexts");

  let subdomain = "sub." + host;
  let subPub = sss.isSecureHost(sss.HEADER_HSTS, subdomain, 0);
  let subPriv = sss.isSecureHost(sss.HEADER_HSTS, subdomain,
                                 Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.equal(subPub, secure && includeSubdomains,
    "STS correct for subdomains in public contexts");
  assert.equal(subPriv, secure && includeSubdomains,
    "STS correct for subdomains in private contexts");
}

/**
 * Tests that enableSTSForHost() works with and without includeSubdomains flag.
 */
exports["test enableSTSForHost()"] = function(assert) {
  Enforcer.enableSTSForHost("enable.test", false);
  assertIsSecureUri(assert, "enable.test", true, false);

  Enforcer.enableSTSForHost("subenable.test", true);
  assertIsSecureUri(assert, "subenable.test", true, true);
}

/**
 * Tests that disableSTSForHost() removes the STS state correctly.
 */
exports["test disableSTSForHost()"] = function(assert) {
  Enforcer.enableSTSForHost("disable.test", false);
  assertIsSecureUri(assert, "disable.test", true, false);

  Enforcer.disableSTSForHost("disable.test");
  assertIsSecureUri(assert, "disable.test", false, false);
}

/**
 * Tests that getURI() creates correct URIs.
 */
exports["test getURI()"] = function(assert) {
  let uri = Enforcer.getURI("example.com");
  assert.equal(uri.scheme, "http", "http:// was appended to the uri");
  assert.equal(uri.host, "example.com", "uri was created correctly");
}

/**
 * Tests that updateSTSForHost() works in different setups.
 */
exports["test updateSTSForHost()"] = function(assert) {
  // An array of test cases. Each case contains following objects:
  // * initial - the initial state for the host before calling updateSTSForHost
  // * updated - the state to set with updateSTSForHost and assert on
  const cases = [
    { initial: { enforce: true, includeSubdomains: true },
      updated: { enforce: true, includeSubdomains: false } },
    { initial: { enforce: true, includeSubdomains: false },
      updated: { enforce: true, includeSubdomains: true } },
    { initial: { enforce: true, includeSubdomains: false },
      updated: { enforce: false, includeSubdomains: true } },
    { initial: { enforce: false, includeSubdomains: false },
      updated: { enforce: true, includeSubdomains: false } },
    { initial: { enforce: false, includeSubdomains: false },
      updated: { enforce: true, includeSubdomains: false } },
    { initial: { enforce: false, includeSubdomains: false },
      updated: { enforce: true, includeSubdomains: true } },
  ];

  let i = 0;
  for (let { initial, updated } of cases) {
    let host = "update" + (i++) + ".test";

    if (initial.enforce) {
      // Set STS to be enforced at lower level.
      Enforcer.enableSTSForHost(host, initial.includeSubdomains);
      assertIsSecureUri(assert, host, true, initial.includeSubdomains);
    }

    // Update the STS status and assert that the updates were correctly
    // performed.
    Enforcer.updateSTSForHost(host, updated.enforce, updated.includeSubdomains);
    assertIsSecureUri(assert, host, updated.enforce, updated.includeSubdomains);
  }
}

/**
 * Tests that getSTSStatusForHost() returns correct statuses in different cases.
 */

exports["test getSTSStatusForHost()"] = function (assert) {
  Enforcer.enableSTSForHost("statustest.com");
  Enforcer.storage.enforceHosts = {
    "userstatustest.com": { includeSubdomains: false },
    "subdomainstatustest.com": { includeSubdomains: true }
  };

  // Enforced by the site
  assert.equal(Enforcer.getSTSStatusForHost("statustest.com"),
    Enforcer.status.SITE_ENFORCED,
    "Status for site enforced STS is correct.");

  // Enforced by the user
  assert.equal(Enforcer.getSTSStatusForHost("userstatustest.com"),
    Enforcer.status.USER_ENFORCED,
    "Status for user enforced STS is correct.");

  // Enforced by the user + subdomains
  assert.equal(Enforcer.getSTSStatusForHost("subdomainstatustest.com"),
    Enforcer.status.USER_ENFORCED_WITH_SUBDOMAINS,
    "Status for user enforced STS \\w subdomains is correct.");

  // A subdomain of a domain enforced by the user
  assert.equal(Enforcer.getSTSStatusForHost("sub.subdomainstatustest.com"),
    Enforcer.status.USER_ENFORCED_PARENT,
    "Status for subdomain with user enforced STS on parent domain is correct.");

  // Not enforced
  assert.equal(Enforcer.getSTSStatusForHost("notenforced.com"),
    Enforcer.status.NOT_ENFORCED,
    "Status for unenforced STS is correct.");
};

/**
 * Tests that ensureSTS() seeds the STS status correctly.
 */
exports["test ensureSTS()"] = function (assert) {
  Enforcer.storage.enforceHosts = {
    "ensuretest.com": { includeSubdomains: false },
    "subensuretest.com": { includeSubdomains: true }
  };

  Enforcer.ensureSTS();
  assertIsSecureUri(assert, "ensuretest.com", true, false);
  assertIsSecureUri(assert, "subensuretest.com", true, true);
  assertIsSecureUri(assert, "notensure.com", false, false);
};

/**
 * Tests that setSTSForHost() works.
 */
exports["test setSTSForHost()"] = function (assert) {
  if (!Enforcer.storage.enforceHosts) {
    Enforcer.storage.enforceHosts = {};
  }

  let cases = [
    {
      expected: Enforcer.status.USER_ENFORCED_WITH_SUBDOMAINS,
      enforce: true,
      sub: true,
    },
    {
      expected: Enforcer.status.USER_ENFORCED,
      enforce: true,
      sub: false,
    },
    {
      expected: Enforcer.status.NOT_ENFORCED,
      enforce: false,
      sub: false,
    },
    {
      expected: Enforcer.status.NOT_ENFORCED,
      enforce: false,
      sub: true,
    },
  ];

  let i = 0;
  for (let { expected, enforce, sub } of cases) {
    let host = "set" + (i++) + ".test";
    Enforcer.setSTSForHost(host, enforce, sub);
    assertIsSecureUri(assert, host, enforce, sub);
    assert.equal(Enforcer.getSTSStatusForHost(host), expected,
      "The status is correct.");
  }
};

/**
 * Test that the parent domain causing STS to be enforced is correctly
 * detected.
 */
exports["test parent domain sts"] = function (assert) {
  Enforcer.setSTSForHost("parent.test", true, true);

  assert.equal(Enforcer.getSTSStatusForHost("sub.parent.test"),
    Enforcer.status.USER_ENFORCED_PARENT,
    "STS on TLD+1 parent domain detected.");
  assert.equal(Enforcer.getSTSStatusForHost("foo.bar.sub.subtest.com"),
    Enforcer.status.USER_ENFORCED_PARENT,
    "STS on non TLD+N parent domain detected.");
  assert.equal(Enforcer.getEnforcingParentHost("sub.parent.test"),
    "parent.test", "getEnforcingParentHost() returned correct host.");
  assert.equal(Enforcer.getEnforcingParentHost("foo.bar.sub.subtest.com"),
    "parent.test", "getEnforcingParentHost() returned correct host.");
};

// Run everything.
require("sdk/test").run(exports);
