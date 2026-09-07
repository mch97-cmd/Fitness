// POST /api/generate
// Body: profile fields collected from the intake wizard.
// Generates a tailored gym + diet program via Workers AI and stores it in D1.

const MODEL = "@cf/zai-org/glm-4.7-flash";

function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function buildPrompt(profile) {
  const conditionsNote = profile.conditions
    ? `The user reports the following health conditions / injuries: ${profile.conditions}. Adjust exercise selection and intensity to be safe for these conditions, avoid contraindicated movements, and explicitly note where the user should consult a doctor before proceeding.`
    : "The user reports no health conditions or injuries.";

  return `You are a certified strength coach and nutritionist. Design a personalized program for this person.

Profile:
- Name: ${profile.name || "N/A"}
- Sex: ${profile.sex}
- Age: ${profile.age}
- Height: ${profile.height_cm} cm
- Weight: ${profile.weight_kg} kg
- Body type: ${profile.body_type}
- Activity level: ${profile.activity_level}
- Goal: ${profile.goal}
- Training experience: ${profile.experience_level}
- Training days per week: ${profile.days_per_week}
- Available equipment: ${profile.equipment}
- Dietary preferences: ${profile.dietary_prefs || "none specified"}
${conditionsNote}

Respond with ONLY valid JSON, no markdown fences, matching exactly this shape:
{
  "gym_program": {
    "summary": "short overview of the training approach",
    "weekly_split": ["Day 1: ...", "Day 2: ..."],
    "days": [
      {
        "day": "Day 1 - Push",
        "exercises": [
          { "name": "Bench Press", "sets": 4, "reps": "6-8", "notes": "" }
        ]
      }
    ]
  },
  "diet_program": {
    "summary": "short overview of the nutrition approach",
    "daily_calories": 2400,
    "macros": { "protein_g": 180, "carbs_g": 250, "fat_g": 70 },
    "meals": [
      { "name": "Breakfast", "example": "description of a sample meal" }
    ]
  },
  "notes": "safety notes, disclaimers, and any condition-specific cautions"
}`;
}

function extractJson(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("Model did not return JSON");
  return JSON.parse(text.slice(start, end + 1));
}

export async function onRequestPost({ request, env }) {
  let profile;
  try {
    profile = await request.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const required = ["sex", "age", "height_cm", "weight_kg", "goal", "activity_level", "experience_level", "days_per_week"];
  for (const field of required) {
    if (profile[field] === undefined || profile[field] === null || profile[field] === "") {
      return badRequest(`Missing required field: ${field}`);
    }
  }

  const prompt = buildPrompt(profile);

  let aiResult;
  try {
    aiResult = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: "You output only valid JSON. No prose, no markdown fences." },
        { role: "user", content: prompt },
      ],
      max_tokens: 2048,
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: "AI generation failed: " + err.message }, 502);
  }

  const rawText = aiResult.response || "";
  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Could not parse AI response", raw: rawText }, 502);
  }

  const profileId = crypto.randomUUID();
  const planId = crypto.randomUUID();

  try {
    await env.DB.prepare(
      `INSERT INTO profiles (id, name, sex, age, height_cm, weight_kg, body_type, activity_level, goal, experience_level, days_per_week, equipment, conditions, dietary_prefs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        profileId,
        profile.name || null,
        profile.sex,
        profile.age,
        profile.height_cm,
        profile.weight_kg,
        profile.body_type || null,
        profile.activity_level,
        profile.goal,
        profile.experience_level,
        profile.days_per_week,
        profile.equipment || null,
        profile.conditions || null,
        profile.dietary_prefs || null
      )
      .run();

    await env.DB.prepare(
      `INSERT INTO plans (id, profile_id, gym_program, diet_program, notes, raw_model_output)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(
        planId,
        profileId,
        JSON.stringify(parsed.gym_program || {}),
        JSON.stringify(parsed.diet_program || {}),
        parsed.notes || null,
        rawText
      )
      .run();
  } catch (err) {
    return jsonResponse({ ok: false, error: "Database error: " + err.message }, 500);
  }

  return jsonResponse({
    ok: true,
    plan_id: planId,
    gym_program: parsed.gym_program,
    diet_program: parsed.diet_program,
    notes: parsed.notes,
  });
}
