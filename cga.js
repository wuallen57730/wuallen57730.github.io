document.addEventListener("DOMContentLoaded", () => {
  const gradePoints = {
    "A+": 4.3,
    A: 4.0,
    "A-": 3.7,
    "B+": 3.3,
    B: 3.0,
    "B-": 2.7,
    "C+": 2.3,
    C: 2.0,
    "C-": 1.7,
    D: 1.0,
    F: 0.0,
  };

  const specialWeights = {
    "COMP 2011": 4,
    "COMP 2012": 4,
    "COMP 2611": 4,
    "COMP 2711H": 4,
    "COMP 3111": 4,
    "MATH 1012": 4,
    "ELEC 2600": 4,
    "COMP 4981": 6,
  };

  let totalPoints = 0;
  let totalCredits = 0;

  const courseRows = document.querySelectorAll(".course-list > div");

  courseRows.forEach((row) => {
    const textSpan = row.querySelector("span.text");
    if (textSpan) {
      const courseCode = textSpan.textContent.trim();
      // Check if it starts with COMP, MATH, or ELEC
      if (/^(COMP|MATH|ELEC)\s+\w+/.test(courseCode)) {
        const gradeElement = row.querySelector("span.code > strong");
        if (gradeElement) {
          const grade = gradeElement.textContent.trim();
          if (gradePoints.hasOwnProperty(grade)) {
            let weight = 3; // Default weight
            const normalizedCode = courseCode.replace(/\s+/g, " ");

            if (specialWeights[normalizedCode]) {
              weight = specialWeights[normalizedCode];
            }

            totalPoints += gradePoints[grade] * weight;
            totalCredits += weight;
          }
        }
      }
    }
  });

  if (totalCredits > 0) {
    const cga = totalPoints / totalCredits;
    const cgaElement = document.getElementById("cga-value");
    if (cgaElement) {
      cgaElement.textContent = cga.toFixed(3) + " / 4.3";
    }
  }
});
