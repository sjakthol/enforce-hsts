const WindowUtils = require('sdk/window/utils');
const BrowserWindows = require("sdk/windows").browserWindows;
const ViewFor = require("sdk/view/core").viewFor;
const PrivateBrowsing = require("sdk/private-browsing");
const _ = require("sdk/l10n").get;

// The style used by other containers. It's applied by element id so we can't
// use the default definition
const CONTAINER_STYLE =
  "padding: 0.5em 0 1em;" +
  "-moz-padding-start: calc(2em + 24px);" +
  "-moz-padding-end: 1em;";

const DESCRIPTION_STYLE = "white-space: pre-wrap;" +
  "font-size: 110%;" +
  "margin: 0;";

const { Enforcer } = require("./enforcer");

const IdentityPopupIntegration = {
  /**
   * Initiates the identity popup integration.
   */
  init: function () {
    this.refreshIdentityPopup = this.refreshIdentityPopup.bind(this);
    this.updateEnforcementStatus = this.updateEnforcementStatus.bind(this);

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

    let section = this.createElement(doc, "hbox", {
      "class": "identity-popup-section",
      id: "sts-section"
    });

    let container = this.createElement(doc, "vbox", {
      flex: 1,
      style: CONTAINER_STYLE
    });

    let header = this.createElement(doc, "description", {
      "class": "identity-popup-headline",
      crop: "end",
      value: _("ui.status.title")
    });

    let status = this.createElement(doc, "description", {
      id: "sts-status",
      style: DESCRIPTION_STYLE
    }, _("ui.status.error"));

    let checkboxContainer = this.createElement(doc, "vbox", {
      id: "sts-checkboxes",
      flex: 1
    });

    let cbCurrentDomain = this.createElement(doc, "checkbox", {
      label: _("ui.checkbox.enforce"),
      id: "sts-cb-enforce"
    })

    let cbInclude = this.createElement(doc, "checkbox", {
      label: _("ui.checkbox.include_sub"),
      id: "sts-cb-include"
    });

    checkboxContainer.appendChild(cbCurrentDomain);
    checkboxContainer.appendChild(cbInclude);

    section.appendChild(container);
    container.appendChild(header);
    container.appendChild(status);
    container.appendChild(checkboxContainer);

    popup.addEventListener("popupshowing", this.refreshIdentityPopup);

    cbCurrentDomain.addEventListener("command", this.updateEnforcementStatus);
    cbInclude.addEventListener("command", this.updateEnforcementStatus);

    doc.getElementById("identity-popup-mainView").appendChild(section);
  },

  /**
   * Event handler for the STS checkbox.
   */
  updateEnforcementStatus: function (event) {
    let doc = event.target.ownerDocument;
    let uri = doc.getElementById("content").currentURI;

    let enforce = doc.getElementById("sts-cb-enforce");
    let include = doc.getElementById("sts-cb-include");

    Enforcer.setSTSForHost(uri.host, enforce.checked, include.checked);

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
    let section = doc.getElementById("sts-section");
    let status = doc.getElementById("sts-status");
    let enforce = doc.getElementById("sts-cb-enforce");
    let include = doc.getElementById("sts-cb-include");
    if (!uri.schemeIs("https")) {
      section.hidden = true;
      return;
    }

    // Reset all state.
    section.hidden = false;
    include.hidden = false;
    enforce.hidden = false;
    include.disable = false;
    enforce.disable = false;
    include.checked = false;
    enforce.checked = false;

    switch (Enforcer.getSTSStatusForHost(uri.host)) {
      case Enforcer.status.USER_ENFORCED:
        status.textContent = _("ui.status.user_enforced");
        enforce.checked = true;
        break;

      case Enforcer.status.USER_ENFORCED_WITH_SUBDOMAINS:
        status.textContent = _("ui.status.user_enforced");
        include.checked = true;
        enforce.checked = true;
        break;

      case Enforcer.status.USER_ENFORCED_PARENT:
        let h = Enforcer.getEnforcingParentHost(uri.host)
        status.textContent = _("ui.status.user_enforced_parent", h);

        include.disabled = true;
        include.checked = true;

        enforce.disabled = true;
        enforce.checked = true;
        break;

      case Enforcer.status.SITE_ENFORCED:
        status.textContent = _("ui.status.site_enforced");
        include.hidden = true;
        enforce.hidden = true;
        break;

      case Enforcer.status.NOT_ENFORCED:
        status.textContent = _("ui.status.not_enforced");
        break;
    }
  },

  destroy: function () {
    console.log("destroy")
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

      let status = doc.getElementById("sts-section");
      if (status) {
        status.remove();

        // Remove checkbox listeners
        let cbEnforce = doc.getElementById("sts-cb-enforce");
        let cbInclude = doc.getElementById("sts-cb-include");

        cbEnforce.removeEventListener("command", this.updateEnforcementStatus);
        cbInclude.removeEventListener("command", this.updateEnforcementStatus);
      }
    }
  }

};

exports.IdentityPopupIntegration = IdentityPopupIntegration;
