const { Enforcer } = require("./lib/enforcer");
const { IdentityPopupIntegration } = require("./lib/identity-popup-integration");

Enforcer.init();
IdentityPopupIntegration.init();

exports.onUnload = function () {
  IdentityPopupIntegration.destroy();
};
