import { sql } from "./test-support";

/**
 * Most integration tests use anonymous sign-in as a stand-in for "an organiser who signed in", so the database's
 * "organisers need a real account" rule is switched off while they run, and back on afterwards. One test turns it on
 * to check the rule itself.
 */
const SETTING = "require_account_to_create_group";

export default function setup() {
  sql(`update app_settings set bool_value = false where key = '${SETTING}'`);
  return () => {
    sql(`update app_settings set bool_value = true where key = '${SETTING}'`);
  };
}
