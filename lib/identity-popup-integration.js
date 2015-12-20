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
    let { doc, popup } = this.popupFor(window);

    if (!doc || !popup) {
      // Nothing to add here.
      return;
    }

    // The outer container for everything.
    let section = this.createElement(doc, "hbox", {
      "class": "identity-popup-section",
      id: "sts-section"
    });

    // Inner container for text
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
    let section = doc.getElementById("sts-section");
    let { enforce, include } = this.checkboxesFor(section);

    // Update the state according to the checkboxes.
    Enforcer.setSTSForHost(uri.host, enforce.checked, include.checked);

    // Update the UI.
    this.refreshIdentityPopup(event);
  },

  /**
   * Refreshes the STS status for the identity popup of the target window of
   * the event.
   */
  refreshIdentityPopup: function (event) {
    let doc = event.target.ownerDocument;
    let uri = doc.getElementById("content").currentURI;
    let section = doc.getElementById("sts-section");
    if (!uri.schemeIs("https")) {
      section.hidden = true;
      return;
    }

    // Get the relevant nodes
    let status = doc.getElementById("sts-status");
    let { enforce, include } = this.checkboxesFor(status);

    // Reset all checkbox state.
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

        // Should be edited in the parent domain, not here.
        include.disabled = true;
        include.checked = true;

        enforce.disabled = true;
        enforce.checked = true;
        break;

      case Enforcer.status.SITE_ENFORCED:
        status.textContent = _("ui.status.site_enforced");
        // Don't even show the controls since the site is enforcing STS.
        include.hidden = true;
        enforce.hidden = true;
        break;

      case Enforcer.status.NOT_ENFORCED:
        status.textContent = _("ui.status.not_enforced");
        break;
    }
  },

  destroy: function () {
    for (let win of WindowUtils.windows(null, { includePrivate: true })) {
      let { doc, popup } = this.popupFor(win);

      popup.removeEventListener("popupshowing", this.refreshIdentityPopup);

      let status = doc.getElementById("sts-section");
      if (status) {
        // Remove checkbox listeners.
        let { enforce, include } = this.checkboxesFor(status);
        enforce.removeEventListener("command", this.updateEnforcementStatus);
        include.removeEventListener("command", this.updateEnforcementStatus);

        // Remove the section.
        status.remove();
      }
    }
  },

  /**
   * Resolves the document and identity popup for given window
   *
   * @param {Object} window
   *        The Jetpack window object to use.
   *
   * @return an object with form { popup, doc } with the popup and document of
   *   this window (both null if not avaialble).
   */
  popupFor: function(window) {
    let dom = ViewFor(window);
    if (!dom) {
      console.error("Can't get a DOMWindow from window object.");
      return { popup: null, doc: null };
    }

    let doc = dom.document;
    if (!doc){
      console.error("DOMWindow does not have a document.");
      return { popup: null, doc: null };
    }

    let popup = doc.getElementById("identity-popup");
    if (!popup) {
      console.error("The chrome document does not contain #identity-popup");
      return { popup, doc };
    }
  },

  /**
   * Retrieve the STS checkboxes for the given identity popup.
   *
   * @param {Element} el
   *        The identity popup or STS status container to retrieve the
   *        checkboxes from.
   * @return An object of form { enforce, include } where enforce is the
   * Enforce STS checkbox and include the Include Subdomains checkbox.
   */
  checkboxesFor: function(el) {
    let enforce = el.ownerDocument.getElementById("sts-cb-enforce");
    let include = el.ownerDocument.getElementById("sts-cb-enforce");

    return { enforce, include };
  }
};

exports.IdentityPopupIntegration = IdentityPopupIntegration;
