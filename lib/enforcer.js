const {Cu, Ci, Cc} = require("chrome");
const SimpleStorage = require("sdk/simple-storage");

const Enforcer = {
  /**
   * Possible statuses host might have.
   */
  status: {
    /**
     * Neither the site nor the user enforces STS.
     */
    NOT_ENFORCED: "NOT_ENFORCED",

    /**
     * The site enforces STS via Strict-Transport-Security header.
     */
    SITE_ENFORCED: "SITE_ENFORCED",

    /**
     * User has enforced STS on this site.
     */
    USER_ENFORCED: "USER_ENFORCED",

    /**
     * User has enforced STS on a parent domain for this site.
     */
    USER_ENFORCED_PARENT: "USER_ENFORCED_PARENT",
  },

  /**
   * Initialize the extension. Ensures that user specified hosts have STS set.
   */
  init: function () {
    this.ensureSTS();
  },

  /**
   * Ensures that the hosts user has specified enforce Strict Transport
   * Security.
   */
  ensureSTS: function () {
    if (!this.storage.enforceHosts) {
      this.storage.enforceHosts = {};
    }

    for (let host in this.storage.enforceHosts) {
      this.enableSTSForHost(host);
    }
  },

  /**
   * Returns the current status for given host.
   *
   * @param {String} host
   *        The hostname to check.
   * @return {String} One of Enforcer.status constants.
   */
  getSTSStatusForHost: function (host) {
    // Has STS been enforced by the user on this site (exact domain match)?
    if (this.storage.enforceHosts[host] === true) {
      return this.status.USER_ENFORCED;
    }

    let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"]
                        .getService(Ci.nsIEffectiveTLDService);
    // Has STS been enforced on one of the parent domains?
    for (let i = 0;; ++i) {
      try {
        // Is the parent domain enforced by user?
        let hostparent = eTLDService.getBaseDomainFromHost(host, i);
        if (this.storage.enforceHosts[hostparent] === true)
          return this.status.USER_ENFORCED_PARENT;

      } catch (e) {
        // NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS comes when it's time to
        // terminate the loop.
        break;
      }
    }

    // Does the site enforce STS itself?
    let uri = this.getURI(host);
    if (this.sss.isSecureURI(this.sss.HEADERS_HSTS, uri, 0)) {
      return this.status.SITE_ENFORCED;
    }

    // No STS for this site.
    return this.status.NOT_ENFORCED;
  },

  /**
   * Toggles the STS ensuring state for given host.
   *
   * @param {String} host
   *        The host to toggle.
   */
  toggleSTSEnforcingForHost: function (host) {
    switch (this.getSTSStatusForHost(host)) {
      case this.status.USER_ENFORCED:
        this.disableSTSForHost(host);
        delete this.storage.enforceHosts[host];
        break;

      case this.status.NOT_ENFORCED:
        this.enableSTSForHost(host);
        this.storage.enforceHosts[host] = true;
        break;
    }
  },

  /**
   * Enables Strict Transport Security for given host.
   *
   * @param {String} host
   *        The host to enable STS for.
   */
  enableSTSForHost: function (host) {
    const value = "max-age=31556900; includeSubDomains;";
    const uri = this.getURI(host);

    // Normal mode.
    this.sss.unsafeProcessHeader(this.sss.HEADERS_HSTS, uri, value, 0, {}, {});

    // Private mode.
    this.sss.unsafeProcessHeader(this.sss.HEADERS_HSTS, uri, value, Ci.nsISocketProvider.NO_PERMANENT_STORAGE, {}, {});
  },

  /**
   * Disables Strict Transport Security for given host.
   *
   * @param {String} host
   *        The host to disable STS for.
   */
  disableSTSForHost: function (host) {
    let nsURI = this.getURI(host);

    this.sss.removeState(this.sss.HEADERS_HSTS, nsURI, 0);
    this.sss.removeState(this.sss.HEADERS_HSTS, nsURI, Ci.nsISocketProvider.NO_PERMANENT_STORAGE);
  },

  /**
   * Creates an nsIURI from an string URI (https?) or hostname.
   *
   * @param {String} uri
   *        The uri to convert.
   * @return {nsIURI} The nsIURI object.
   */
  getURI: function (uri) {
    if (uri instanceof Ci.nsIURI)
      return uri;

    if (!uri.startsWith("http")) {
      uri = "http://" + uri + "/";
    }

    let ioService = Cc["@mozilla.org/network/io-service;1"]
                      .getService(Ci.nsIIOService);

    return ioService.newURI(uri, null, null);
  },

  /**
   * Returns an instance of nsISiteSecurityService.
   */
  get sss () {
    return Cc["@mozilla.org/ssservice;1"]
             .getService(Ci.nsISiteSecurityService);
  },

  /**
   * Returns the SimpleStorage object for this addon.
   */
  get storage () {
    return SimpleStorage.storage;
  },
};

exports.Enforcer = Enforcer;
