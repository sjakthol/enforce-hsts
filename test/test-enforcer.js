const { Cu, Ci, Cc } = require("chrome");

const { Enforcer } = require("./enforcer");
const sss = Cc["@mozilla.org/ssservice;1"]
             .getService(Ci.nsISiteSecurityService);

exports["test sts toggling"] = function(assert) {
  let enforcePub = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com", 0);
  let enforcePriv = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com",
                                     Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.ok(!enforcePub, "STS is not enforced for non-private windows initially.");
  assert.ok(!enforcePriv, "STS is not enforced for private windows initially.");

  Enforcer.enableSTSForHost("enforce.com");

  enforcePub = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com", 0);
  enforcePriv = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com",
                                 Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.ok(enforcePub, "STS is enforced for non-private windows.");
  assert.ok(enforcePriv, "STS is enforced for private windows.");

  Enforcer.disableSTSForHost("enforce.com");

  enforcePub = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com", 0);
  enforcePriv = sss.isSecureHost(sss.HEADER_HSTS, "enforce.com",
                                 Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.ok(!enforcePub, "STS is not enforced for non-private windows after disabling it.");
  assert.ok(!enforcePriv, "STS is not enforced for private windows after disabling it.");
};

exports["test sts status"] = function (assert) {
  Enforcer.enableSTSForHost("statustest.com");
  Enforcer.storage.enforceHosts = { "userstatustest.com": true };

  assert.equal(Enforcer.getSTSStatusForHost("statustest.com"),
            Enforcer.status.SITE_ENFORCED, "Status for site enforced STS is correct.");

  assert.equal(Enforcer.getSTSStatusForHost("userstatustest.com"),
            Enforcer.status.USER_ENFORCED, "Status for user enforced STS is correct.");

  assert.equal(Enforcer.getSTSStatusForHost("notenforced.com"),
            Enforcer.status.NOT_ENFORCED, "Status for unenforced STS is correct.");
};

exports["test ensureSTS"] = function (assert) {
  Enforcer.storage.enforceHosts = { "ensuretest.com": true };
  Enforcer.ensureSTS();

  let enforcePub = sss.isSecureHost(sss.HEADER_HSTS, "ensuretest.com", 0);
  let enforcePriv = sss.isSecureHost(sss.HEADER_HSTS, "ensuretest.com",
                                     Ci.nsISocketProvider.NO_PERMANENT_STORAGE);

  assert.ok(enforcePub, "STS ensured for public windows.");
  assert.ok(enforcePriv, "STS ensured for private windows.");
};

exports["test enforce status toggling"] = function (assert) {
  if (!Enforcer.storage.enforceHosts) {
    Enforcer.storage.enforceHosts = {}
  }

  Enforcer.toggleSTSEnforcingForHost("enforsetoggle.com");

  assert.equal(Enforcer.getSTSStatusForHost("enforsetoggle.com"),
    Enforcer.status.USER_ENFORCED, "NONE -> USER toggled correctly.");

  Enforcer.toggleSTSEnforcingForHost("enforsetoggle.com");

  assert.equal(Enforcer.getSTSStatusForHost("enforsetoggle.com"),
    Enforcer.status.NOT_ENFORCED, "USER -> NONE toggled correctly.");
};

require("sdk/test").run(exports);
