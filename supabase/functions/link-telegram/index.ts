import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type TelegramUser = {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
};

function parseInitData(initData: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash") || "";
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dataCheck = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  return { hash, dataCheck, params };
}

async function verifyTelegram(initData: string, botToken: string): Promise<TelegramUser | null> {
  if (!initData) return null;
  const { hash, dataCheck, params } = parseInitData(initData);
  if (!hash) return null;
  const secret = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(botToken));
  const key = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(dataCheck));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  if (hex !== hash) return null;
  const userRaw = params.get("user");
  if (!userRaw) return null;
  const user = JSON.parse(userRaw) as TelegramUser;
  if (!user?.id) return null;
  return user;
}

Deno.serve(async (req) => {
  try {
    const { initData, code } = await req.json();
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!botToken || !supabaseUrl || !serviceRole) {
      return new Response(JSON.stringify({ ok: false, error: "Missing env" }), { status: 500 });
    }

    const tgUser = await verifyTelegram(initData, botToken);
    if (!tgUser) {
      return new Response(JSON.stringify({ ok: false }), { status: 401 });
    }

    const supabase = createClient(supabaseUrl, serviceRole);
    const { data: codeRow } = await supabase
      .from("link_codes")
      .select("supabase_user_id, expires_at, used_at")
      .eq("code", code)
      .maybeSingle();

    if (!codeRow || codeRow.used_at || new Date(codeRow.expires_at) <= new Date()) {
      return new Response(JSON.stringify({ ok: false }), { status: 400 });
    }

    await supabase.from("user_links").upsert({
      supabase_user_id: codeRow.supabase_user_id,
      telegram_user_id: String(tgUser.id)
    });

    await supabase
      .from("link_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code", code);

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (_error) {
    return new Response(JSON.stringify({ ok: false }), { status: 500 });
  }
});
