// GET /api/plan/:id — fetch a previously generated plan by id.

export async function onRequestGet({ env, params }) {
  const plan = await env.DB.prepare(
    `SELECT p.id, p.gym_program, p.diet_program, p.notes, p.created_at,
            pr.name, pr.goal
     FROM plans p JOIN profiles pr ON pr.id = p.profile_id
     WHERE p.id = ?`
  )
    .bind(params.id)
    .first();

  if (!plan) {
    return new Response(JSON.stringify({ ok: false, error: "Plan not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      plan_id: plan.id,
      name: plan.name,
      goal: plan.goal,
      created_at: plan.created_at,
      gym_program: JSON.parse(plan.gym_program),
      diet_program: JSON.parse(plan.diet_program),
      notes: plan.notes,
    }),
    { headers: { "content-type": "application/json" } }
  );
}
