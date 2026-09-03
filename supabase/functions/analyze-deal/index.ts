// index.ts — analyze-deal Edge Function
//
// Called from the portal's Deal Analyzer page using the anon key (standard
// Supabase Functions invocation auth — verify_jwt=true means the caller
// must be a logged-in or anon Supabase client, same as any other request).
// Internally this function uses the SERVICE ROLE key to write to
// deal_analyses, bypassing RLS — that key is a Supabase-managed environment
// variable automatically available inside every Edge Function, injected by
// the platform itself. It is never sent to or visible from the browser.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { underwriteDeal } from "./underwritingEngine.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Use POST" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const {
    arv, rehab, sqft, condition, rehabOverride, askingPrice, city, isMLS,
    monthlyRent, allowFlex, propertyAddress, propertyId, persist,
  } = body;

  if (arv == null || (rehab == null && (sqft == null || !condition)) || askingPrice == null || !city) {
    return new Response(
      JSON.stringify({ error: "arv, askingPrice, city, and either rehab OR (sqft + condition) are required." }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS } }
    );
  }

  let result;
  try {
    result = underwriteDeal({
      arv, rehab, sqft, condition, rehabOverride,
      askingPrice, city, isMLS: !!isMLS, monthlyRent: monthlyRent ?? null,
      allowFlex: !!allowFlex, propertyAddress: propertyAddress ?? null,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  let savedRow = null;
  if (persist) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from("deal_analyses")
      .insert({
        property_id: propertyId ?? null,
        property_address: propertyAddress ?? null,
        arv,
        rehab: result.inputs.rehab,
        asking_price: askingPrice,
        city,
        is_mls: !!isMLS,
        monthly_rent: monthlyRent ?? null,
        allow_flex: !!allowFlex,
        deal_status: result.dealStatus,
        recommended_strategy: result.recommendedStrategy,
        offer_ladder: result.offerLadder,
        flip_result: result.strategies.flip,
        wholesale_result: result.strategies.wholesale,
        brrrr_result: result.strategies.brrrr,
        engine_version: result.engineVersion,
      })
      .select()
      .single();

    if (error) {
      return new Response(JSON.stringify({ error: error.message, result }), {
        status: 500,
        headers: { "Content-Type": "application/json", ...CORS },
      });
    }
    savedRow = data;
  }

  return new Response(JSON.stringify({ result, saved: savedRow }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
});

