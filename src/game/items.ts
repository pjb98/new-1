export type ItemCategory = "pot" | "nutrient" | "light" | "tool" | "packaging" | "cosmetic" | "misc";
export type Currency = "cash" | "weed_token";

export interface ShopItem {
  id: string;
  name: string;
  description: string;
  category: ItemCategory;
  cost: number;
  currency: Currency;
  unlockLevel: number;
  stackable: boolean;
  icon: string;
  effect?: Record<string, number>;
}

export const SHOP_ITEMS: ShopItem[] = [
  // Pots
  { id: "basic_pot", name: "Basic Pot", description: "Standard 1-gallon pot. Gets the job done.", category: "pot", cost: 20, currency: "cash", unlockLevel: 1, stackable: true, icon: "🪴" },
  { id: "big_pot", name: "Big Pot", description: "+20% yield per harvest.", category: "pot", cost: 80, currency: "cash", unlockLevel: 2, stackable: true, icon: "🏺", effect: { yieldBonus: 0.2 } },
  { id: "smart_pot", name: "Smart Pot", description: "+40% yield, +10% quality.", category: "pot", cost: 200, currency: "cash", unlockLevel: 4, stackable: true, icon: "⭐", effect: { yieldBonus: 0.4, qualityBonus: 10 } },
  { id: "diamond_pot", name: "Diamond Pot", description: "+60% yield, +20% quality. Flex on the block.", category: "pot", cost: 500, currency: "weed_token", unlockLevel: 6, stackable: true, icon: "💎", effect: { yieldBonus: 0.6, qualityBonus: 20 } },

  // Nutrients
  { id: "basic_nutes", name: "Basic Nutrients", description: "+5 quality per application.", category: "nutrient", cost: 15, currency: "cash", unlockLevel: 1, stackable: true, icon: "🧪", effect: { qualityBoost: 5 } },
  { id: "advanced_nutes", name: "Advanced Nutrients", description: "+12 quality per application.", category: "nutrient", cost: 40, currency: "cash", unlockLevel: 3, stackable: true, icon: "⚗️", effect: { qualityBoost: 12 } },
  { id: "premium_nutes", name: "Premium Nutrients", description: "+20 quality per application.", category: "nutrient", cost: 100, currency: "cash", unlockLevel: 5, stackable: true, icon: "🔬", effect: { qualityBoost: 20 } },
  { id: "weed_fertilizer", name: "$WEED Fertilizer", description: "+30 quality, 2x grow speed for 1 day. Token-powered.", category: "nutrient", cost: 50, currency: "weed_token", unlockLevel: 1, stackable: true, icon: "💚", effect: { qualityBoost: 30, speedBoost: 2 } },

  // Lights
  { id: "basic_led", name: "Basic LED", description: "Required for Rare+ strains. Basic grow light.", category: "light", cost: 150, currency: "cash", unlockLevel: 1, stackable: false, icon: "💡" },
  { id: "pro_led", name: "Pro LED", description: "+10% grow speed. Full spectrum.", category: "light", cost: 400, currency: "cash", unlockLevel: 3, stackable: false, icon: "🔆", effect: { speedBonus: 0.1 } },
  { id: "hps_light", name: "HPS Light", description: "+25% grow speed. Industry standard.", category: "light", cost: 800, currency: "cash", unlockLevel: 5, stackable: false, icon: "☀️", effect: { speedBonus: 0.25 } },
  { id: "quantum_board", name: "Quantum Board", description: "+40% grow speed, +15% quality. The goat.", category: "light", cost: 300, currency: "weed_token", unlockLevel: 4, stackable: false, icon: "⚡", effect: { speedBonus: 0.4, qualityBonus: 15 } },

  // Tools
  { id: "watering_can", name: "Watering Can", description: "Waters 1 pot per use.", category: "tool", cost: 10, currency: "cash", unlockLevel: 1, stackable: false, icon: "🚿" },
  { id: "hose", name: "Garden Hose", description: "Waters up to 3 pots per use.", category: "tool", cost: 75, currency: "cash", unlockLevel: 2, stackable: false, icon: "🌊", effect: { waterArea: 3 } },
  { id: "sprinkler", name: "Auto Sprinkler", description: "Waters all pots automatically every 6h.", category: "tool", cost: 350, currency: "cash", unlockLevel: 4, stackable: false, icon: "💦", effect: { autoWater: 1 } },
  { id: "ph_meter", name: "pH Meter", description: "+5% quality on harvest when used.", category: "tool", cost: 75, currency: "cash", unlockLevel: 2, stackable: false, icon: "📊", effect: { harvestQualityBonus: 5 } },
  { id: "trimmer", name: "Trimmer", description: "+10% yield on harvest.", category: "tool", cost: 120, currency: "cash", unlockLevel: 3, stackable: false, icon: "✂️", effect: { harvestYieldBonus: 0.1 } },
  { id: "microscope", name: "Microscope", description: "Reveals exact quality before harvest.", category: "tool", cost: 300, currency: "cash", unlockLevel: 4, stackable: false, icon: "🔭" },
  { id: "burner_phone", name: "Burner Phone", description: "Reduces heat by 30. Stay safe.", category: "misc", cost: 50, currency: "cash", unlockLevel: 1, stackable: true, icon: "📱", effect: { heatReduce: 30 } },
  { id: "weed_burner", name: "$WEED Burner Phone", description: "Reduces heat by 60. Premium privacy.", category: "misc", cost: 20, currency: "weed_token", unlockLevel: 1, stackable: true, icon: "🔥", effect: { heatReduce: 60 } },

  // Packaging
  { id: "zip_bags", name: "Zip Bags (10pk)", description: "Required to package product for sale.", category: "packaging", cost: 5, currency: "cash", unlockLevel: 1, stackable: true, icon: "🛍️" },
  { id: "mason_jars", name: "Mason Jars (5pk)", description: "+10% sell price. Keeps it fresh.", category: "packaging", cost: 15, currency: "cash", unlockLevel: 2, stackable: true, icon: "🫙", effect: { sellBonus: 0.1 } },
  { id: "luxury_box", name: "Luxury Box (3pk)", description: "+25% sell price. Top shelf presentation.", category: "packaging", cost: 50, currency: "cash", unlockLevel: 4, stackable: true, icon: "📦", effect: { sellBonus: 0.25 } },
  { id: "token_pack", name: "$WEED Packaging (5pk)", description: "+40% sell price. VIP customers love it.", category: "packaging", cost: 30, currency: "weed_token", unlockLevel: 3, stackable: true, icon: "💚", effect: { sellBonus: 0.4 } },

  // Cosmetics (token-only)
  { id: "neon_room", name: "Neon Room Theme", description: "Purple neon lighting for your grow room.", category: "cosmetic", cost: 100, currency: "weed_token", unlockLevel: 1, stackable: false, icon: "🌈" },
  { id: "golden_pots", name: "Golden Pot Skins", description: "All pots get a gold finish. Bougie.", category: "cosmetic", cost: 200, currency: "weed_token", unlockLevel: 1, stackable: false, icon: "🏆" },
  { id: "dealer_fit", name: "Dealer Fit", description: "Custom outfit for your street character.", category: "cosmetic", cost: 150, currency: "weed_token", unlockLevel: 1, stackable: false, icon: "👔" },
  { id: "matrix_room", name: "Matrix Room Theme", description: "Green digital rain in your grow room.", category: "cosmetic", cost: 250, currency: "weed_token", unlockLevel: 1, stackable: false, icon: "💻" },
];

export function getItem(id: string): ShopItem | undefined {
  return SHOP_ITEMS.find(i => i.id === id);
}
