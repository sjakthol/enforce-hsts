const { Cu, Ci, Cc } = require("chrome");

const { Enforcer } = require("enforcer");
const { IdentityPopupIntegration } = require("identity-popup-integration");

Enforcer.init();
IdentityPopupIntegration.init();
