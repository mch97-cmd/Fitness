// Deterministic slot/catalog engine for gym program generation.
// The AI's job is narrowed to "pick the best exercise ID per slot from a
// pre-filtered, equipment-and-experience-eligible list" — it can no longer
// invent an exercise, violate equipment constraints, or mismatch a day's
// movement pattern, because those are enforced by construction here rather
// than hoped for via prompt instructions.

import catalog from "./catalog.json";

export const EXPERIENCE_RANK = { beginner: 1, intermediate: 2, advanced: 3 };

const EQUIPMENT_PROFILES = catalog.slot_category_taxonomy.equipment_model.profiles;

const PRIMARY_SLOTS = new Set([
  "horizontal_press",
  "vertical_press",
  "squat_pattern",
  "hinge_pattern",
  "horizontal_row",
  "vertical_pull",
  "full_body_compound",
]);

const SETS_REPS_BY_EXPERIENCE = {
  beginner: { primary: { sets: 3, reps: "8-10" }, accessory: { sets: 2, reps: "10-12" } },
  intermediate: { primary: { sets: 4, reps: "6-10" }, accessory: { sets: 3, reps: "10-15" } },
  advanced: { primary: { sets: 4, reps: "5-8" }, accessory: { sets: 3, reps: "10-15" } },
};

export function getEquipmentTokens(equipmentProfile) {
  return EQUIPMENT_PROFILES[equipmentProfile] || EQUIPMENT_PROFILES.bodyweight_only;
}

function equipmentAllowed(exerciseEquipment, userTokens) {
  return exerciseEquipment.every((tok) => userTokens.includes(tok));
}

function experienceAllowed(minExperience, userExperience) {
  const minRank = EXPERIENCE_RANK[minExperience] || 1;
  const userRank = EXPERIENCE_RANK[userExperience] || 1;
  return minRank <= userRank;
}

// Days requested beyond what the template library covers (7) fall back to
// the largest available template rather than failing outright.
export function selectTemplate(daysPerWeek, equipmentProfile, goal) {
  const clampedDays = Math.max(1, Math.min(daysPerWeek, 6));
  const tier = equipmentProfile === "bodyweight_only" ? "bodyweight_only" : "standard";
  const matches = catalog.slot_templates.filter(
    (t) => t.days_per_week === clampedDays && t.equipment_tier === tier
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];

  const preferSplit = goal === "build muscle" || goal === "strength";
  const preferred = matches.find((t) => (preferSplit ? /ppl|upper_lower/.test(t.id) : /full_body/.test(t.id)));
  return preferred || matches[0];
}

export function getEligibleExercises(slotCategory, equipmentProfile, experienceLevel) {
  const userTokens = getEquipmentTokens(equipmentProfile);
  return catalog.exercise_catalog.filter(
    (ex) =>
      ex.slot_categories.includes(slotCategory) &&
      equipmentAllowed(ex.equipment, userTokens) &&
      experienceAllowed(ex.min_experience, experienceLevel)
  );
}

function setsRepsFor(slotCategory, experienceLevel) {
  const bucket = SETS_REPS_BY_EXPERIENCE[experienceLevel] || SETS_REPS_BY_EXPERIENCE.beginner;
  return PRIMARY_SLOTS.has(slotCategory) ? bucket.primary : bucket.accessory;
}

// Builds, per day, the list of slots with their eligible candidate exercises
// and deterministic sets/reps — this is what gets handed to the AI to choose
// from, and what the response is validated against afterward.
export function buildSlotPlan(template, equipmentProfile, experienceLevel) {
  return template.days.map((day) => ({
    label: day.label,
    slots: day.slots.map((slotCategory) => ({
      slotCategory,
      candidates: getEligibleExercises(slotCategory, equipmentProfile, experienceLevel),
      setsReps: setsRepsFor(slotCategory, experienceLevel),
    })),
  }));
}

export function resolveExerciseId(id) {
  return catalog.exercise_catalog.find((ex) => ex.id === id) || null;
}

// Turns the AI's slot selections into the final display-ready gym_program
// shape. Never trusts the AI's exercise_id blindly: if it picked something
// outside that slot's eligible candidates (wrong ID, hallucinated ID, or a
// duplicate already used earlier that day), it's deterministically replaced
// with a valid, unused candidate from the same slot instead.
export function resolveGymSelection(slotPlan, aiSelection) {
  const days = slotPlan.map((planDay, dayIndex) => {
    const aiDay = aiSelection?.days?.[dayIndex];
    const aiExercisesBySlot = new Map((aiDay?.exercises || []).map((e) => [e.slot, e]));
    const usedIds = new Set();

    const exercises = planDay.slots.map((slot) => {
      const aiSlot = aiExercisesBySlot.get(slot.slotCategory);
      const candidateIds = new Set(slot.candidates.map((c) => c.id));

      let chosen = aiSlot && candidateIds.has(aiSlot.exercise_id) ? resolveExerciseId(aiSlot.exercise_id) : null;

      if (chosen && usedIds.has(chosen.id)) chosen = null; // avoid duplicate within the same day

      if (!chosen) {
        chosen = slot.candidates.find((c) => !usedIds.has(c.id)) || slot.candidates[0] || null;
      }

      if (!chosen) return null; // no eligible exercise at all for this slot (shouldn't happen given catalog coverage)

      usedIds.add(chosen.id);

      return {
        name: chosen.name,
        sets: slot.setsReps.sets,
        reps: slot.setsReps.reps,
        notes: (aiSlot?.note || chosen.form_cue || "").trim(),
      };
    });

    return {
      day: planDay.label,
      exercises: exercises.filter(Boolean),
    };
  });

  return {
    summary: aiSelection?.summary || "",
    days,
  };
}
