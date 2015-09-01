const { Cu, Ci, Cc } = require("chrome");

const WindowUtils = require('sdk/window/utils');
const BrowserWindows = require("sdk/windows").browserWindows;
const ViewFor = require("sdk/view/core").viewFor;
const PrivateBrowsing = require("sdk/private-browsing");
const _ = require("sdk/l10n").get;

const { Enforcer } = require("./enforcer");

const IdentityPopupIntegration = {
  /**
   * Initiates the identity popup integration.
   */
  init: function () {
    this.refreshIdentityPopup = this.refreshIdentityPopup.bind(this);
    this.toggleEnforcing = this.toggleEnforcing.bind(this);

    // Bug 1196577 - BrowserWindows does not include pre-existing private
    // browsing windows when addon enabled or installed
    //
    // Thus we need to se sdk/window/utils instead which allows us specify that
    // we want them too.
    for (let window of WindowUtils.windows(null, { includePrivate: true }))
      this._attachIdentityPopup(window);

    BrowserWindows.on("open", window => {
      if (PrivateBrowsing.isPrivate(window)) {
        // Ensure that STS is still enforced for private contexts. They are
        // stored in-memory and cleared from time to time.
        Enforcer.ensureSTS();
      }

      // Plug into the identity popup.
      this._attachIdentityPopup(window);
    });
  },

  /**
   * A helper that creates an element.
   *
   * @param {Document} document
   *        The document to create the element to.
   * @param {String} tagName
   *        The element type.
   * @param {Object} attributes.
   *        Attributes of this element as key-value pairs. Optional.
   * @param {String} textContent
   *        The textContent of this element.
   */
  createElement: function (document, tagName, attributes, textContent) {
    let result = document.createElement(tagName);
    for (let key in attributes)
      result.setAttribute(key, attributes[key]);

    if (textContent)
      result.textContent = textContent;

    return result;
  },

  /**
   * Attaches into identity popup of the given window.
   *
   * @param {Window} window
   *        The chrome window to attach to.
   */
  _attachIdentityPopup: function (window) {
    let dom = ViewFor(window);
    if (!dom)
      return console.error("Can't get a DOMWindow from window object.");

    let doc = dom.document;
    if (!doc)
      return console.error("DOMWindow does not have a document.");

    let popup = doc.getElementById("identity-popup");
    if (!popup)
      return console.error("The chrome document does not contain #identity-popup");

    popup.addEventListener("popupshowing", this.refreshIdentityPopup);

    let checkbox = this.createElement(doc, "checkbox", {
      checked: false,
      id: "sts-status",
      label: _("ui.status.error"),
    });

    checkbox.addEventListener("command", this.toggleEnforcing);

    // From Fx41 onwards the id of the box is identity-popup-security-content.
    var box = doc.getElementById("identity-popup-content-box") ||
              doc.getElementById("identity-popup-security-content");
    box.appendChild(checkbox);
  },

  /**
   * Event handler for the STS checkbox.
   */
  toggleEnforcing: function (event) {
    let doc = event.target.ownerDocument;
    let uri = doc.getElementById("content").currentURI;

    Enforcer.toggleSTSEnforcingForHost(uri.host);

    this.refreshIdentityPopup(event);
  },

  /**
   * Refreshes the STS status for the identity popup of the target window of
   * the event.
   */
  refreshIdentityPopup: function (event) {
    let popup = event.target;
    let doc = popup.ownerDocument;
    let uri = doc.getElementById("content").currentURI;
    let checkbox = doc.getElementById("sts-status");
    if (!uri.schemeIs("https")) {
      checkbox.hidden = true;
      return;
    }

    checkbox.hidden = false;

    switch (Enforcer.getSTSStatusForHost(uri.host)) {
      case Enforcer.status.USER_ENFORCED:
        checkbox.label = _("ui.status.user_enforced");
        checkbox.checked = true;
        checkbox.disabled = false;
        break;

      case Enforcer.status.USER_ENFORCED_PARENT:
        checkbox.label = _("ui.status.user_enforced_parent");
        checkbox.checked = true;
        checkbox.disabled = true;
        break;

      case Enforcer.status.SITE_ENFORCED:
        checkbox.label = _("ui.status.site_enforced");
        checkbox.checked = true;
        checkbox.disabled = true;
        break;

      case Enforcer.status.NOT_ENFORCED:
        checkbox.label = _("ui.status.not_enforced");
        checkbox.checked = false;
        checkbox.disabled = false;
        break;
    }
  },

  destroy: function () {
    for (let window of WindowUtils.windows(null, { includePrivate: true })) {
      let dom = ViewFor(window);
      if (!dom)
        return console.error("Can't get a DOMWindow from window object.");

      let doc = dom.document;
      if (!doc)
        return console.error("DOMWindow does not have a document.");

      let popup = doc.getElementById("identity-popup");
      if (!popup)
        return console.error("The chrome document does not contain #identity-popup");

      popup.removeEventListener("popupshowing", this.refreshIdentityPopup);

      let status = doc.getElementById("sts-status");
      if (status) {
        status.remove();
      }
    }
  }

};

exports.IdentityPopupIntegration = IdentityPopupIntegration;
