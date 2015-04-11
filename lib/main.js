const { Cu, Ci, Cc } = require("chrome");

const { Enforcer } = require("enforcer");
const { IdentityPopupIntegration } = require("identity-popup-integration");

exports.main = function (reason) {
  Enforcer.init();
  IdentityPopupIntegration.init();
}

exports.onUnload = function (reason) {
  IdentityPopupIntegration.destroy();
};
