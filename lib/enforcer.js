const { Ci, Cc } = require("chrome");
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
     * User has enforced STS on this site and all subdomains.
     */
    USER_ENFORCED_WITH_SUBDOMAINS: "USER_ENFORCED_WITH_SUBDOMAINS",

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
      let { includeSubdomains } = this.storage.enforceHosts[host];
      this.enableSTSForHost(host, includeSubdomains);
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
    if (this.storage.enforceHosts[host] !== undefined) {
      if (this.storage.enforceHosts[host].includeSubdomains) {
        return this.status.USER_ENFORCED_WITH_SUBDOMAINS;
      }

      return this.status.USER_ENFORCED;
    }

    // Has the user enforced STS for a parent host?
    if (this.getEnforcingParentHost(host) !== null) {
      return this.status.USER_ENFORCED_PARENT;
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
   * Get the host name that causes STS to be enforced on this site.
   *
   * @param {String} host
   *        The hostname to check.
   * @return {String|null} the hostname or null if STS is not enforced.
   */
  getEnforcingParentHost: function(host) {
    let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"]
                        .getService(Ci.nsIEffectiveTLDService);
    for (let i = 0;; ++i) {
      try {
        // Is the parent domain enforced by user?
        let hostparent = eTLDService.getBaseDomainFromHost(host, i);
        if (this.storage.enforceHosts[hostparent] !== undefined)
          return hostparent;

      } catch (e) {
        // NS_ERROR_INSUFFICIENT_DOMAIN_LEVELS comes when it's time to
        // terminate the loop.
        break;
      }
    }

    return null;
  },

  /**
   * Toggles the STS ensuring state for given host.
   *
   * @param {String} host
   *        The host to toggle.
   * @param {Boolean} enforce
   *        True to enforce STS, false to remove it.
   * @param {Boolean} includeSubdomains
   *        True to include subdomains, false to stop including subdomains.
   */
  setSTSForHost: function (host, enforce, includeSubdomains) {
    switch (this.getSTSStatusForHost(host)) {
      case this.status.USER_ENFORCED_WITH_SUBDOMAINS:
      case this.status.USER_ENFORCED:
      case this.status.NOT_ENFORCED:

        this.updateSTSForHost(host, enforce, includeSubdomains);

        // Update the storage.
        if (enforce) {
          this.storage.enforceHosts[host] = {
            includeSubdomains
          };
        } else {
          delete this.storage.enforceHosts[host];
        }

        break;
    }
  },

  /**
   * Sets the STS status for the host to follow the given parameters.
   *
   * @param {String} host
   *        The host to toggle.
   * @param {Boolean} enforce
   *        True to enforce STS, false to remove it.
   * @param {Boolean} includeSubdomains
   *        True to include subdomains, false to stop including subdomains.
   */
  updateSTSForHost: function(host, enforce, includeSubdomains) {
    // First, clear any existing state.
    this.disableSTSForHost(host);

    // Then, set the new state.
    if (enforce) {
      this.enableSTSForHost(host, includeSubdomains);
    }
  },

  /**
   * Enables Strict Transport Security for given host.
   *
   * @param {String} host
   *        The host to enable STS for.
   * @param {Boolean} includeSubdomains
   *        Add includeSubdomains directive for STS.
   */
  enableSTSForHost: function (host, includeSubdomains) {
    let value = "max-age=31556900;";
    if (includeSubdomains) {
       value += "includeSubDomains;";
    }

    const uri = this.getURI(host);

    // Normal mode.
    this.sss.unsafeProcessHeader(this.sss.HEADERS_HSTS, uri, value, 0, {}, {});

    // Private mode.
    this.sss.unsafeProcessHeader(this.sss.HEADERS_HSTS, uri, value, Ci.nsISocketProvider.NO_PERMANENT_STORAGE, {}, {});
  },

  /**
   * Disables Strict Transport Security for given host.
   *
   * @param {String} host
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
