import { jsPDF } from "jspdf";

/**
 * A small ARCH D plumbing sheet at 1/4" = 1'-0" for trying the plan tools without real plans.
 * Coordinates below are in feet from the plan origin; 18 points = 1 foot at this scale.
 */
export function createSamplePlanPdf(): Blob {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: [2592, 1728] });
  doc.setProperties({
    title: "Sample Unit A - Plumbing Floor Plan",
    author: "Worth Construction (sample)",
    subject: "Sample plumbing plan for the plan takeoff tools",
    creator: "Worth field tools"
  });

  const FT = 18;
  const ox = 360;
  const oy = 300;
  const X = (feet: number) => ox + feet * FT;
  const Y = (feet: number) => oy + feet * FT;
  const wall = 0.5 * FT;

  doc.setDrawColor(40, 40, 40);
  doc.setFillColor(70, 70, 70);
  const wallRect = (x: number, y: number, w: number, h: number) => doc.rect(X(x), Y(y), w * FT, h * FT, "F");

  // Exterior walls: 34' x 24'
  wallRect(0, 0, 34, 0.5);
  wallRect(0, 23.5, 34, 0.5);
  wallRect(0, 0, 0.5, 24);
  wallRect(33.5, 0, 0.5, 24);
  // Bath 0-9 x 0-10, kitchen 9-24 x 0-12, laundry/mech 24-34 x 0-10
  wallRect(9, 0, 0.5, 10);
  wallRect(0, 10, 9.5, 0.5);
  wallRect(24, 0, 0.5, 10);
  wallRect(24, 10, 10, 0.5);
  doc.setFillColor(255, 255, 255);
  doc.rect(X(3), Y(10) - 1, 3 * FT, wall + 2, "F"); // bath door opening
  doc.rect(X(27), Y(10) - 1, 3 * FT, wall + 2, "F"); // laundry door opening

  doc.setLineWidth(1.2);
  doc.setDrawColor(30, 30, 30);
  // Bath: tub along the left wall, WC and lav on the back wall
  doc.rect(X(0.5), Y(0.5), 2.5 * FT, 5 * FT);
  doc.roundedRect(X(0.8), Y(0.9), 1.9 * FT, 4.2 * FT, 12, 12);
  doc.rect(X(4.4), Y(0.5), 1.6 * FT, 0.8 * FT); // WC tank
  doc.ellipse(X(5.2), Y(2.2), 0.75 * FT, 1 * FT); // WC bowl
  doc.roundedRect(X(6.6), Y(0.5), 2 * FT, 1.7 * FT, 6, 6); // lav
  doc.ellipse(X(7.6), Y(1.35), 0.6 * FT, 0.45 * FT);
  // Kitchen: double sink and dishwasher on the back wall, fridge
  doc.rect(X(13), Y(0.5), 3 * FT, 2 * FT);
  doc.line(X(14.5), Y(0.5), X(14.5), Y(2.5));
  doc.rect(X(16.2), Y(0.5), 2 * FT, 2 * FT);
  doc.rect(X(20.5), Y(0.5), 3 * FT, 2.5 * FT);
  // Laundry / mech: washer, water heater, floor drain
  doc.rect(X(25), Y(0.5), 2.5 * FT, 2.5 * FT);
  doc.circle(X(31.5), Y(2), 1 * FT);
  doc.circle(X(29), Y(6), 0.35 * FT);
  doc.line(X(28.7), Y(6), X(29.3), Y(6));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(30, 30, 30);
  const label = (text: string, x: number, y: number) => doc.text(text, X(x), Y(y), { align: "center" });
  label("TUB", 1.75, 6.2);
  label("WC", 5.2, 4);
  label("LAV", 7.6, 3);
  label("KITCHEN SINK", 14.5, 3.4);
  label("DW", 17.2, 3.4);
  label("REF (ICE MAKER)", 22, 3.8);
  label("WASHER", 26.25, 3.8);
  label("WH-1", 31.5, 3.6);
  label("FD-1", 29, 7.2);
  doc.setFontSize(14);
  label("BATH", 4.5, 8.5);
  label("KITCHEN", 16.5, 8);
  label("LAUNDRY / MECH", 29, 8.8);
  label("LIVING", 17, 18);

  // Dimension string along the top to calibrate against
  doc.setLineWidth(0.6);
  doc.line(X(0), Y(-2), X(34), Y(-2));
  [0, 9, 24, 34].forEach((feet) => doc.line(X(feet), Y(-2.4), X(feet), Y(-1.6)));
  doc.setFontSize(10);
  label(`9'-0"`, 4.5, -2.4);
  label(`15'-0"`, 16.5, -2.4);
  label(`10'-0"`, 29, -2.4);

  // Sewer and water service stubs
  doc.setLineDashPattern([10, 6], 0);
  doc.setDrawColor(120, 53, 15);
  doc.line(X(5), Y(24), X(5), Y(34));
  doc.setDrawColor(29, 78, 216);
  doc.line(X(31), Y(24), X(31), Y(34));
  doc.setLineDashPattern([], 0);
  doc.setFontSize(10);
  doc.text(`4" SAN. TO SEWER (FIELD VERIFY INVERT)`, X(5.6), Y(33));
  doc.text(`1-1/4" WATER SERVICE FROM METER`, X(31.6), Y(33));

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text("UNIT A - PLUMBING FLOOR PLAN", X(0), Y(42));
  doc.setFontSize(11);
  doc.setFont("helvetica", "normal");
  doc.text(`SCALE: 1/4" = 1'-0"`, X(0), Y(43.4));

  // Title block
  const tbx = 2592 - 480;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(1.5);
  doc.rect(36, 36, 2592 - 72, 1728 - 72);
  doc.rect(tbx, 1728 - 400, 444, 364);
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("WORTH CONSTRUCTION", tbx + 20, 1728 - 360);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("SAMPLE FOURPLEX - FOR TAKEOFF PRACTICE", tbx + 20, 1728 - 340);
  doc.setFontSize(13);
  doc.text("PLUMBING FLOOR PLAN - UNIT A", tbx + 20, 1728 - 280);
  doc.setFontSize(10);
  doc.text(`SCALE: 1/4" = 1'-0"`, tbx + 20, 1728 - 255);
  doc.text("SHEET", tbx + 20, 1728 - 150);
  doc.setFontSize(48);
  doc.setFont("helvetica", "bold");
  doc.text("P-101", tbx + 20, 1728 - 95);

  return doc.output("blob");
}
