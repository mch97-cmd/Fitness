// POST /api/generate
// Body: profile fields collected from the intake wizard.
// Generates a tailored gym + diet program via Workers AI and stores it in D1.

const MODEL = "@cf/ibm-granite/granite-4.0-h-micro";

function badRequest(message) {
  return jsonResponse({ ok: false, error: message }, 400);
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// LLMs are unreliable at arithmetic, so calorie/macro targets are computed
// deterministically here and handed to the model as fixed constraints —
// the model is only used for exercise selection and meal ideas, never math.
const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  "very active": 1.9,
};

const GOAL_CALORIE_ADJUSTMENT = {
  "lose fat": -500,
  "body recomposition": -200,
  "build muscle": 300,
  strength: 150,
  "general fitness": 0,
};

const GOAL_PROTEIN_PER_KG = {
  "lose fat": 2.2,
  "body recomposition": 2.2,
  "build muscle": 2.0,
  strength: 2.0,
  "general fitness": 1.8,
};

function computeNutritionTargets(profile) {
  const { sex, age, height_cm, weight_kg, activity_level, goal } = profile;

  // Mifflin-St Jeor
  let bmr = 10 * weight_kg + 6.25 * height_cm - 5 * age;
  bmr += sex === "male" ? 5 : sex === "female" ? -161 : -78;

  const multiplier = ACTIVITY_MULTIPLIERS[activity_level] || 1.375;
  const tdee = bmr * multiplier;

  const adjustment = GOAL_CALORIE_ADJUSTMENT[goal] ?? 0;
  const safetyFloor = sex === "male" ? 1500 : 1200;
  const daily_calories = Math.round(Math.max(tdee + adjustment, safetyFloor));

  const proteinPerKg = GOAL_PROTEIN_PER_KG[goal] || 1.8;
  const protein_g = Math.round(weight_kg * proteinPerKg);
  const fat_g = Math.round((daily_calories * 0.25) / 9);
  const carbs_g = Math.max(Math.round((daily_calories - protein_g * 4 - fat_g * 9) / 4), 0);

  return {
    bmr: Math.round(bmr),
    tdee: Math.round(tdee),
    daily_calories,
    macros: { protein_g, carbs_g, fat_g },
  };
}

function buildPrompt(profile, targets) {
  const conditionsNote = profile.conditions
    ? `The user reports the following health conditions / injuries: ${profile.conditions}. Adjust exercise selection and intensity to be safe for these conditions, avoid contraindicated movements, and explicitly note where the user should consult a doctor before proceeding. Only include condition-specific cautions you are actually confident are medically relevant — do not invent restrictions without a clear basis.`
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

Nutrition targets have already been calculated for this person — use these EXACT numbers in the diet_program output, do not recalculate or change them:
- Daily calories: ${targets.daily_calories} kcal
- Protein: ${targets.macros.protein_g} g
- Carbs: ${targets.macros.carbs_g} g
- Fat: ${targets.macros.fat_g} g
Only design meal ideas that roughly fit these numbers — do not output different calorie/macro values.

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
    "daily_calories": ${targets.daily_calories},
    "macros": { "protein_g": ${targets.macros.protein_g}, "carbs_g": ${targets.macros.carbs_g}, "fat_g": ${targets.macros.fat_g} },
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

  const targets = computeNutritionTargets(profile);
  const prompt = buildPrompt(profile, targets);

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

  const rawText =
    aiResult.response ||
    aiResult.result?.response ||
    aiResult.choices?.[0]?.message?.content ||
    "";
  let parsed;
  try {
    parsed = extractJson(rawText);
  } catch (err) {
    return jsonResponse({ ok: false, error: "Could not parse AI response", raw: rawText }, 502);
  }

  // Never trust the model's arithmetic — always overwrite with the computed values.
  parsed.diet_program = {
    ...(parsed.diet_program || {}),
    daily_calories: targets.daily_calories,
    macros: targets.macros,
  };

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
