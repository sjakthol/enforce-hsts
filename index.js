const { Cu, Ci, Cc } = require("chrome");

const { Enforcer } = require("./lib/enforcer");
const { IdentityPopupIntegration } = require("./lib/identity-popup-integration");

Enforcer.init();
IdentityPopupIntegration.init();

exports.onUnload = function (reason) {
  IdentityPopupIntegration.destroy();
};
