import { send } from "../lib/util.js";

// Tells the studio page which AI features have keys configured, without revealing the keys.
export default function handler(req, res) {
  send(res, 200, {
    photoroom: Boolean(process.env.PHOTOROOM_API_KEY),
    runway: Boolean(process.env.RUNWAYML_API_SECRET),
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    passcode: Boolean(process.env.STUDIO_PASSCODE),
    catalogue: Boolean(process.env.DATABASE_URL && process.env.ADMIN_PASSCODE),
  });
}
