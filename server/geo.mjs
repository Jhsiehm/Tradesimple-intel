export const POSTAL = {
  AL:"01",AK:"02",AZ:"04",AR:"05",CA:"06",CO:"08",CT:"09",DE:"10",DC:"11",FL:"12",GA:"13",
  HI:"15",ID:"16",IL:"17",IN:"18",IA:"19",KS:"20",KY:"21",LA:"22",ME:"23",MD:"24",MA:"25",
  MI:"26",MN:"27",MS:"28",MO:"29",MT:"30",NE:"31",NV:"32",NH:"33",NJ:"34",NM:"35",NY:"36",
  NC:"37",ND:"38",OH:"39",OK:"40",OR:"41",PA:"42",RI:"44",SC:"45",SD:"46",TN:"47",TX:"48",
  UT:"49",VT:"50",VA:"51",WA:"53",WV:"54",WI:"55",WY:"56",PR:"72",VI:"78",GU:"66",AS:"60",MP:"69"
};

export const FIPS_TO_POSTAL = Object.fromEntries(Object.entries(POSTAL).map(([k, v]) => [v, k]));

export const STATE_NAME_TO_POSTAL = {
  Alabama:"AL",Alaska:"AK",Arizona:"AZ",Arkansas:"AR",California:"CA",Colorado:"CO",Connecticut:"CT",
  Delaware:"DE","District of Columbia":"DC",Florida:"FL",Georgia:"GA",Hawaii:"HI",Idaho:"ID",Illinois:"IL",
  Indiana:"IN",Iowa:"IA",Kansas:"KS",Kentucky:"KY",Louisiana:"LA",Maine:"ME",Maryland:"MD",Massachusetts:"MA",
  Michigan:"MI",Minnesota:"MN",Mississippi:"MS",Missouri:"MO",Montana:"MT",Nebraska:"NE",Nevada:"NV",
  "New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC",
  "North Dakota":"ND",Ohio:"OH",Oklahoma:"OK",Oregon:"OR",Pennsylvania:"PA","Rhode Island":"RI",
  "South Carolina":"SC","South Dakota":"SD",Tennessee:"TN",Texas:"TX",Utah:"UT",Vermont:"VT",Virginia:"VA",
  Washington:"WA","West Virginia":"WV",Wisconsin:"WI",Wyoming:"WY","Puerto Rico":"PR"
};

export function houseGeoid(state, district) {
  const rawState = String(state || "");
  const postal = POSTAL[rawState.toUpperCase()] ? rawState.toUpperCase() : STATE_NAME_TO_POSTAL[rawState];
  const fips = postal ? POSTAL[postal] : null;
  if (!fips) return null;
  const raw = String(district ?? "").toUpperCase();
  if (!raw || raw === "NULL" || raw === "UNDEFINED") return null;
  if (raw === "AL" || raw === "0" || raw === "00") return `${fips}00`;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return `${fips}${String(n).padStart(2, "0")}`;
}

const STAGES = ["introduced", "committee", "markup", "reported", "floor", "passed chamber", "enrolled", "became law"];

export function stageFromText(text) {
  const t = String(text || "").toLowerCase();
  if (/became public law|became law|signed by president/.test(t)) return "became law";
  if (/enrolled/.test(t)) return "enrolled";
  if (/passed senate|passed house|agreed to in senate|agreed to in house/.test(t)) return "passed chamber";
  if (/placed on senate legislative calendar|placed on house calendar|rule provides|consideration/.test(t)) return "floor";
  if (/reported|ordered to be reported/.test(t)) return "reported";
  if (/markup/.test(t)) return "markup";
  if (/referred to|committee/.test(t)) return "committee";
  if (/introduced|received/.test(t)) return "introduced";
  return null;
}

export function ladderFromActions(actions) {
  let highest = 0;
  const hits = [];
  for (const action of actions) {
    const stage = stageFromText(action.text || action.latestAction?.text || "");
    if (!stage) continue;
    const idx = STAGES.indexOf(stage);
    hits.push({ stage, date: action.actionDate || action.date || null, text: action.text || "" });
    if (idx > highest) highest = idx;
  }
  return {
    stages: STAGES.map((name, index) => ({
      name,
      reached: index <= highest && hits.length > 0
    })),
    current: hits.length ? STAGES[highest] : "introduced",
    actions: hits.slice(-8).reverse()
  };
}
