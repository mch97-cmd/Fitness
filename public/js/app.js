(function () {
  const form = document.getElementById("intake-form");
  const intakeSection = document.getElementById("intake-section");
  const loadingSection = document.getElementById("loading-section");
  const resultSection = document.getElementById("result-section");
  const errorSection = document.getElementById("error-section");
  const submitBtn = document.getElementById("submit-btn");
  let lastResult = null;
  let lastProfileName = "";

  function showOnly(section) {
    [intakeSection, loadingSection, resultSection, errorSection].forEach((s) => {
      s.hidden = s !== section;
    });
  }

  function collectProfile() {
    const data = new FormData(form);
    const profile = Object.fromEntries(data.entries());
    profile.age = Number(profile.age);
    profile.height_cm = Number(profile.height_cm);
    profile.weight_kg = Number(profile.weight_kg);
    profile.days_per_week = Number(profile.days_per_week);
    return profile;
  }

  function renderExercise(ex) {
    const row = document.createElement("div");
    row.className = "exercise-row";
    row.innerHTML = `
      <span class="exercise-name"></span>
      <span class="exercise-meta"></span>
    `;
    row.querySelector(".exercise-name").textContent = ex.name || "Exercise";
    const meta = [ex.sets ? `${ex.sets} sets` : null, ex.reps ? `${ex.reps} reps` : null, ex.notes || null]
      .filter(Boolean)
      .join(" · ");
    row.querySelector(".exercise-meta").textContent = meta;
    return row;
  }

  function renderGymProgram(program) {
    document.getElementById("gym-summary").textContent = program.summary || "";
    const daysContainer = document.getElementById("gym-days");
    daysContainer.innerHTML = "";
    (program.days || []).forEach((day) => {
      const block = document.createElement("div");
      block.className = "day-block";
      const heading = document.createElement("h4");
      heading.textContent = day.day || "Training day";
      block.appendChild(heading);
      (day.exercises || []).forEach((ex) => block.appendChild(renderExercise(ex)));
      daysContainer.appendChild(block);
    });
  }

  function renderDietProgram(program) {
    document.getElementById("diet-summary").textContent = program.summary || "";

    const macrosRow = document.getElementById("diet-macros");
    macrosRow.innerHTML = "";
    const macros = program.macros || {};
    const pills = [
      program.daily_calories ? `${program.daily_calories} kcal/day` : null,
      macros.protein_g ? `${macros.protein_g}g protein` : null,
      macros.carbs_g ? `${macros.carbs_g}g carbs` : null,
      macros.fat_g ? `${macros.fat_g}g fat` : null,
    ].filter(Boolean);
    pills.forEach((text) => {
      const pill = document.createElement("span");
      pill.className = "macro-pill";
      pill.textContent = text;
      macrosRow.appendChild(pill);
    });

    const mealsContainer = document.getElementById("diet-meals");
    mealsContainer.innerHTML = "";
    (program.meals || []).forEach((meal) => {
      const row = document.createElement("div");
      row.className = "meal-row";

      const macroBits = [
        meal.calories ? `${meal.calories} kcal` : null,
        meal.protein_g ? `${meal.protein_g}g protein` : null,
        meal.carbs_g ? `${meal.carbs_g}g carbs` : null,
        meal.fat_g ? `${meal.fat_g}g fat` : null,
      ]
        .filter(Boolean)
        .join(" · ");

      row.innerHTML = `
        <div class="meal-name"></div>
        <div class="meal-example"></div>
        <div class="meal-macros"></div>
        <div class="meal-alt"></div>
      `;
      row.querySelector(".meal-name").textContent = meal.name || "Meal";
      row.querySelector(".meal-example").textContent = meal.example || "";
      row.querySelector(".meal-macros").textContent = macroBits;
      if (meal.alternative) {
        row.querySelector(".meal-alt").textContent = `Swap option: ${meal.alternative}`;
      }
      mealsContainer.appendChild(row);
    });
  }

  async function submitProfile(profile) {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Something went wrong generating your program.");
    }
    return data;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;

    submitBtn.disabled = true;
    showOnly(loadingSection);

    try {
      const profile = collectProfile();
      const result = await submitProfile(profile);
      lastResult = result;
      lastProfileName = profile.name || "";
      renderGymProgram(result.gym_program || {});
      renderDietProgram(result.diet_program || {});
      document.getElementById("plan-notes").textContent = result.notes || "";
      showOnly(resultSection);
    } catch (err) {
      document.getElementById("error-text").textContent = err.message;
      showOnly(errorSection);
    } finally {
      submitBtn.disabled = false;
    }
  });

  function downloadExcel() {
    if (!lastResult) return;

    const gym = lastResult.gym_program || {};
    const diet = lastResult.diet_program || {};
    const macros = diet.macros || {};

    const gymRows = [["Day", "Exercise", "Sets", "Reps", "Notes"]];
    (gym.days || []).forEach((day) => {
      (day.exercises || []).forEach((ex) => {
        gymRows.push([day.day || "", ex.name || "", ex.sets || "", ex.reps || "", ex.notes || ""]);
      });
    });

    const dietRows = [
      ["Daily Calories", diet.daily_calories || ""],
      ["Protein (g)", macros.protein_g || ""],
      ["Carbs (g)", macros.carbs_g || ""],
      ["Fat (g)", macros.fat_g || ""],
      [],
      ["Meal", "Example", "Alternative", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)"],
    ];
    (diet.meals || []).forEach((meal) => {
      dietRows.push([
        meal.name || "",
        meal.example || "",
        meal.alternative || "",
        meal.calories || "",
        meal.protein_g || "",
        meal.carbs_g || "",
        meal.fat_g || "",
      ]);
    });

    const notesRows = [["Notes"], [lastResult.notes || ""]];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(gymRows), "Gym Program");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dietRows), "Diet Program");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(notesRows), "Notes");

    const filename = lastProfileName
      ? `fitforge-plan-${lastProfileName.replace(/\s+/g, "-").toLowerCase()}.xlsx`
      : "fitforge-plan.xlsx";
    XLSX.writeFile(wb, filename);
  }

  document.getElementById("download-btn").addEventListener("click", downloadExcel);

  document.getElementById("start-over-btn").addEventListener("click", () => {
    showOnly(intakeSection);
  });

  document.getElementById("error-retry-btn").addEventListener("click", () => {
    showOnly(intakeSection);
  });
})();
