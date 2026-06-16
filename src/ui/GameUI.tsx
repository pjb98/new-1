import React, { useEffect, useState, useCallback } from "react";
import { EventBus, EV } from "../game/EventBus";
import { GameState, PotState, StashEntry, CUSTOMERS, xpForLevel } from "../game/save";
import { STRAINS, RARITY_COLORS, RARITY_LABELS, getStrain } from "../game/strains";
import { SHOP_ITEMS } from "../game/items";

type Panel = "none" | "shop" | "stash" | "phone" | "pot" | "sell";

interface Notification { msg: string; type: "success" | "error"; id: number }

let notifId = 0;

export default function GameUI({ walletAddress, weedTokenBalance }: { walletAddress: string | null; weedTokenBalance: number }) {
  const [state, setState] = useState<GameState | null>(null);
  const [panel, setPanel] = useState<Panel>("none");
  const [scene, setScene] = useState<"farm" | "street">("farm");
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [selectedPot, setSelectedPot] = useState<{ potIndex: number; pot: PotState } | null>(null);
  const [selectedStrainId, setSelectedStrainId] = useState<string>("");
  const [shopTab, setShopTab] = useState<"seeds" | "pots" | "nutrients" | "lights" | "tools" | "packaging" | "cosmetics">("seeds");
  const [sellCustomerId, setSellCustomerId] = useState<string | null>(null);
  const [sellStrainId, setSellStrainId] = useState<string>("");
  const [sellGrams, setSellGrams] = useState(1);
  const [nearbyCustomer, setNearbyCustomer] = useState<string | null>(null);
  const [packagingType, setPackagingType] = useState<string>("zip");

  const addNotif = useCallback((msg: string, type: "success" | "error") => {
    const id = notifId++;
    setNotifications(prev => [...prev.slice(-4), { msg, type, id }]);
    setTimeout(() => setNotifications(prev => prev.filter(n => n.id !== id)), 3500);
  }, []);

  useEffect(() => {
    const onState = (s: GameState) => setState({ ...s });
    const onNotif = ({ msg, type }: { msg: string; type: "success" | "error" }) => addNotif(msg, type);
    const onPot = (data: { potIndex: number; pot: PotState }) => { setSelectedPot(data); setPanel("pot"); };
    const onScene = (s: "farm" | "street") => setScene(s);
    const onNearby = (id: string | null) => setNearbyCustomer(id);
    const onSell = (id: string) => { setSellCustomerId(id); setPanel("sell"); };

    EventBus.on(EV.STATE_UPDATE, onState);
    EventBus.on(EV.NOTIFICATION, onNotif);
    EventBus.on(EV.POT_CLICKED, onPot);
    EventBus.on(EV.SCENE_CHANGE, onScene);
    EventBus.on("nearby_customer", onNearby);
    EventBus.on("open_sell_panel", onSell);

    return () => {
      EventBus.off(EV.STATE_UPDATE, onState);
      EventBus.off(EV.NOTIFICATION, onNotif);
      EventBus.off(EV.POT_CLICKED, onPot);
      EventBus.off(EV.SCENE_CHANGE, onScene);
      EventBus.off("nearby_customer", onNearby);
      EventBus.off("open_sell_panel", onSell);
    };
  }, [addNotif]);

  if (!state) return null;

  const xpNeeded = xpForLevel(state.level);
  const xpPrev = xpForLevel(state.level - 1);
  const xpPct = Math.min(100, ((state.xp - xpPrev) / (xpNeeded - xpPrev)) * 100);

  const gameTime = state.gameMins % 1440;
  const hours = Math.floor(gameTime / 60);
  const mins = gameTime % 60;
  const timeStr = `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;

  const colorHex = (n: number) => "#" + n.toString(16).padStart(6, "0");

  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", fontFamily: "monospace" }}>
      {/* HUD Top Bar */}
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 56, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", gap: 16, padding: "0 16px", pointerEvents: "auto", borderBottom: "1px solid #333" }}>
        <div style={{ color: "#4caf50", fontWeight: "bold", fontSize: 18 }}>💵 ${state.money.toLocaleString()}</div>
        <div style={{ color: "#00e676", fontWeight: "bold", fontSize: 14 }}>🌿 {weedTokenBalance.toLocaleString()} $WEED</div>
        <div style={{ color: "#888", fontSize: 13 }}>📅 Day {state.day} {timeStr}</div>
        <div style={{ flex: 1 }} />

        {/* Heat meter */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: state.heat > 60 ? "#ff5252" : "#888", fontSize: 13 }}>🔥 Heat</span>
          <div style={{ width: 80, height: 10, background: "#333", borderRadius: 5, overflow: "hidden" }}>
            <div style={{ width: `${state.heat}%`, height: "100%", background: state.heat > 80 ? "#f44336" : state.heat > 60 ? "#ff9800" : "#4caf50", transition: "width 0.3s" }} />
          </div>
          <span style={{ color: "#888", fontSize: 11 }}>{Math.round(state.heat)}%</span>
        </div>

        {/* Level / XP */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#ffd700", fontWeight: "bold" }}>Lv.{state.level}</span>
          <div style={{ width: 60, height: 8, background: "#333", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: `${xpPct}%`, height: "100%", background: "#ffd700" }} />
          </div>
        </div>

        {/* Wallet */}
        {walletAddress && (
          <div style={{ color: "#888", fontSize: 11 }}>🔗 {walletAddress.slice(0, 4)}...{walletAddress.slice(-4)}</div>
        )}
      </div>

      {/* Bottom toolbar */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 56, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", gap: 12, pointerEvents: "auto", borderTop: "1px solid #333" }}>
        {scene === "farm" ? (
          <>
            <Btn label="🌱 Shop" onClick={() => setPanel(p => p === "shop" ? "none" : "shop")} active={panel === "shop"} />
            <Btn label="🎒 Stash" onClick={() => setPanel(p => p === "stash" ? "none" : "stash")} active={panel === "stash"} />
            <Btn label="📱 Phone" onClick={() => setPanel(p => p === "phone" ? "none" : "phone")} active={panel === "phone"} />
            <Btn label="🚶 Go to Street" onClick={() => EventBus.emit("action:go_street")} color="#ff9800" />
            {(state.inventory["burner_phone"] ?? 0) > 0 && (
              <Btn label={`📵 Burner (${state.inventory["burner_phone"]})`} onClick={() => EventBus.emit("action:use_burner", { itemId: "burner_phone" })} color="#9c27b0" />
            )}
            {(state.inventory["weed_burner"] ?? 0) > 0 && (
              <Btn label={`🔥 Burner (${state.inventory["weed_burner"]})`} onClick={() => EventBus.emit("action:use_burner", { itemId: "weed_burner" })} color="#00e676" />
            )}
          </>
        ) : (
          <>
            <Btn label="🏠 Go to Farm" onClick={() => EventBus.emit("action:go_farm")} color="#4caf50" />
            {nearbyCustomer && (
              <Btn label="💊 Deal" onClick={() => { setSellCustomerId(nearbyCustomer); setPanel("sell"); }} color="#ff9800" />
            )}
            <Btn label="🎒 Stash" onClick={() => setPanel(p => p === "stash" ? "none" : "stash")} active={panel === "stash"} />
          </>
        )}
      </div>

      {/* Notifications */}
      <div style={{ position: "absolute", top: 70, right: 16, display: "flex", flexDirection: "column", gap: 6, pointerEvents: "none" }}>
        {notifications.map(n => (
          <div key={n.id} style={{
            background: n.type === "success" ? "rgba(76,175,80,0.9)" : "rgba(244,67,54,0.9)",
            color: "#fff", padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: "bold",
            animation: "fadeIn 0.2s"
          }}>{n.msg}</div>
        ))}
      </div>

      {/* ======== PANELS ======== */}
      {panel !== "none" && (
        <div onClick={e => e.target === e.currentTarget && setPanel("none")} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "auto" }}>

          {/* POT PANEL */}
          {panel === "pot" && selectedPot && (() => {
            const pot = state.pots[selectedPot.potIndex];
            const strain = pot.strainId ? getStrain(pot.strainId) : null;
            const availableSeeds = STRAINS.filter(s => {
              const seedKey = `seed_${s.id}`;
              return (state.inventory[seedKey] ?? 0) > 0 && state.level >= s.unlockLevel;
            });
            return (
              <Panel title={`Pot #${selectedPot.potIndex + 1}`} onClose={() => setPanel("none")}>
                {strain && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ color: colorHex(strain.color), fontWeight: "bold", fontSize: 16 }}>{strain.name}</div>
                    <div style={{ color: colorHex(RARITY_COLORS[strain.rarity]), fontSize: 12 }}>{RARITY_LABELS[strain.rarity]}</div>
                    <div style={{ color: "#aaa", fontSize: 12, marginTop: 4 }}>Stage: <b style={{ color: "#fff" }}>{pot.stage}</b></div>
                    <div style={{ color: "#aaa", fontSize: 12 }}>Progress: <b style={{ color: "#00e676" }}>{Math.round(pot.growProgress)}%</b></div>
                    <div style={{ color: "#aaa", fontSize: 12 }}>Quality: <b style={{ color: "#ffd700" }}>{Math.round(pot.quality)}%</b></div>
                    <div style={{ color: "#aaa", fontSize: 12 }}>Water: <b style={{ color: pot.waterLevel < 30 ? "#ff5252" : "#4fc3f7" }}>{Math.round(pot.waterLevel)}%</b></div>
                    <div style={{ color: "#aaa", fontSize: 12 }}>Nutrients: <b style={{ color: pot.nutrientLevel < 30 ? "#ff5252" : "#66bb6a" }}>{Math.round(pot.nutrientLevel)}%</b></div>
                  </div>
                )}
                {pot.stage === "empty" ? (
                  <div>
                    <div style={{ color: "#aaa", fontSize: 13, marginBottom: 8 }}>Select a seed to plant:</div>
                    {availableSeeds.length === 0 && <div style={{ color: "#666" }}>No seeds! Buy from shop.</div>}
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {availableSeeds.map(s => {
                        const seedKey = `seed_${s.id}`;
                        return (
                          <button key={s.id} onClick={() => {
                            EventBus.emit("action:plant", { potIndex: selectedPot.potIndex, strainId: s.id });
                            setPanel("none");
                          }} style={{ background: "#1e3a1e", border: `1px solid ${colorHex(s.color)}`, color: colorHex(s.color), padding: "8px 12px", borderRadius: 6, cursor: "pointer", textAlign: "left", fontSize: 13 }}>
                            🌱 {s.name} <span style={{ color: "#888", fontSize: 11 }}>×{state.inventory[seedKey]} | {RARITY_LABELS[s.rarity]}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <ActionBtn label="💧 Water" onClick={() => { EventBus.emit("action:water", { potIndex: selectedPot.potIndex }); setPanel("none"); }} />
                    {(state.inventory["basic_nutes"] ?? 0) > 0 && (
                      <ActionBtn label={`🧪 Basic Nutrients (×${state.inventory["basic_nutes"]})`} onClick={() => { EventBus.emit("action:nutrient", { potIndex: selectedPot.potIndex, itemId: "basic_nutes" }); setPanel("none"); }} />
                    )}
                    {(state.inventory["advanced_nutes"] ?? 0) > 0 && (
                      <ActionBtn label={`⚗️ Advanced Nutrients (×${state.inventory["advanced_nutes"]})`} onClick={() => { EventBus.emit("action:nutrient", { potIndex: selectedPot.potIndex, itemId: "advanced_nutes" }); setPanel("none"); }} />
                    )}
                    {(state.inventory["premium_nutes"] ?? 0) > 0 && (
                      <ActionBtn label={`🔬 Premium Nutrients (×${state.inventory["premium_nutes"]})`} onClick={() => { EventBus.emit("action:nutrient", { potIndex: selectedPot.potIndex, itemId: "premium_nutes" }); setPanel("none"); }} />
                    )}
                    {(state.inventory["weed_fertilizer"] ?? 0) > 0 && (
                      <ActionBtn label={`💚 $WEED Fertilizer ×${state.inventory["weed_fertilizer"]} (token-powered!)`} onClick={() => { EventBus.emit("action:nutrient", { potIndex: selectedPot.potIndex, itemId: "weed_fertilizer" }); setPanel("none"); }} color="#00e676" />
                    )}
                    {pot.stage === "ready" && (
                      <ActionBtn label="✂️ HARVEST!" onClick={() => { EventBus.emit("action:harvest", { potIndex: selectedPot.potIndex }); setPanel("none"); }} color="#ffd700" />
                    )}
                  </div>
                )}
              </Panel>
            );
          })()}

          {/* SHOP PANEL */}
          {panel === "shop" && (
            <Panel title="🌱 Shop" onClose={() => setPanel("none")} wide>
              <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                {(["seeds", "pots", "nutrients", "lights", "tools", "packaging", "cosmetics"] as const).map(t => (
                  <button key={t} onClick={() => setShopTab(t)} style={{ background: shopTab === t ? "#4caf50" : "#333", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 12, textTransform: "capitalize" }}>{t}</button>
                ))}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
                {shopTab === "seeds" && STRAINS.map(s => {
                  const seedKey = `seed_${s.id}`;
                  const locked = state.level < s.unlockLevel;
                  const tokenGated = s.weedTokenGated;
                  const ownedCount = state.inventory[seedKey] ?? 0;
                  const canAfford = tokenGated ? weedTokenBalance >= s.seedCost : state.money >= s.seedCost;
                  return (
                    <div key={s.id} style={{ background: locked ? "#1a1a1a" : "#1e2e1e", border: `1px solid ${locked ? "#333" : colorHex(RARITY_COLORS[s.rarity])}`, borderRadius: 8, padding: "10px 14px", opacity: locked ? 0.5 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <span style={{ color: colorHex(s.color), fontWeight: "bold" }}>{s.name}</span>
                          <span style={{ color: colorHex(RARITY_COLORS[s.rarity]), fontSize: 11, marginLeft: 8 }}>[{RARITY_LABELS[s.rarity]}]</span>
                          {tokenGated && <span style={{ color: "#00e676", fontSize: 11, marginLeft: 6 }}>🌿 TOKEN</span>}
                        </div>
                        <div style={{ color: "#888", fontSize: 11 }}>×{ownedCount} owned</div>
                      </div>
                      <div style={{ color: "#aaa", fontSize: 11, margin: "4px 0" }}>{s.effects}</div>
                      <div style={{ display: "flex", gap: 12, fontSize: 11, color: "#888" }}>
                        <span>⏱ {s.growDays}d grow</span>
                        <span>📦 ~{s.yieldGrams}g yield</span>
                        <span>💵 ${s.sellPricePerG}/g</span>
                      </div>
                      {locked ? (
                        <div style={{ color: "#ff9800", fontSize: 11, marginTop: 4 }}>🔒 Unlock at Level {s.unlockLevel}</div>
                      ) : (
                        <button onClick={() => {
                          if (tokenGated) {
                            EventBus.emit("action:buy_item_token", { itemId: `seed_${s.id}`, isSeed: true, strainId: s.id });
                          } else {
                            EventBus.emit("action:buy_item", { itemId: `seed_${s.id}`, isSeed: true, strainId: s.id });
                          }
                        }} disabled={!canAfford} style={{ marginTop: 6, padding: "4px 12px", background: canAfford ? (tokenGated ? "#00695c" : "#1b5e20") : "#333", color: canAfford ? "#fff" : "#666", border: "none", borderRadius: 4, cursor: canAfford ? "pointer" : "not-allowed", fontSize: 12 }}>
                          {tokenGated ? `Buy 1 seed — ${s.seedCost} 🌿$WEED` : `Buy 1 seed — $${s.seedCost}`}
                        </button>
                      )}
                    </div>
                  );
                })}

                {shopTab !== "seeds" && SHOP_ITEMS.filter(item => {
                  if (shopTab === "pots") return item.category === "pot";
                  if (shopTab === "nutrients") return item.category === "nutrient";
                  if (shopTab === "lights") return item.category === "light";
                  if (shopTab === "tools") return item.category === "tool" || item.category === "misc";
                  if (shopTab === "packaging") return item.category === "packaging";
                  if (shopTab === "cosmetics") return item.category === "cosmetic";
                  return false;
                }).map(item => {
                  const locked = state.level < item.unlockLevel;
                  const isToken = item.currency === "weed_token";
                  const canAfford = isToken ? weedTokenBalance >= item.cost : state.money >= item.cost;
                  const owned = !item.stackable && state.ownedItems.includes(item.id);
                  const qty = state.inventory[item.id] ?? 0;
                  const isCosmetic = item.category === "cosmetic";
                  const cosmeticOwned = isCosmetic && state.cosmetics.includes(item.id);
                  return (
                    <div key={item.id} style={{ background: "#1e1e2e", border: `1px solid ${locked ? "#333" : (isToken ? "#00e676" : "#555")}`, borderRadius: 8, padding: "10px 14px", opacity: locked ? 0.5 : 1 }}>
                      <div style={{ display: "flex", justifyContent: "space-between" }}>
                        <span style={{ color: "#fff", fontWeight: "bold" }}>{item.icon} {item.name}</span>
                        {isToken && <span style={{ color: "#00e676", fontSize: 11 }}>🌿 TOKEN</span>}
                      </div>
                      <div style={{ color: "#aaa", fontSize: 12, margin: "4px 0" }}>{item.description}</div>
                      {!item.stackable && qty > 0 && <div style={{ color: "#888", fontSize: 11 }}>In stock: {qty}</div>}
                      {locked ? (
                        <div style={{ color: "#ff9800", fontSize: 11 }}>🔒 Requires Level {item.unlockLevel}</div>
                      ) : owned || cosmeticOwned ? (
                        <div style={{ color: "#4caf50", fontSize: 11 }}>✅ Owned</div>
                      ) : (
                        <button onClick={() => {
                          if (isToken) EventBus.emit("action:buy_item_token", { itemId: item.id });
                          else EventBus.emit("action:buy_item", { itemId: item.id });
                        }} disabled={!canAfford} style={{ marginTop: 6, padding: "4px 12px", background: canAfford ? (isToken ? "#00695c" : "#333") : "#222", color: canAfford ? "#fff" : "#666", border: "none", borderRadius: 4, cursor: canAfford ? "pointer" : "not-allowed", fontSize: 12 }}>
                          {isToken ? `${item.cost} 🌿$WEED` : `$${item.cost}`}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {/* STASH PANEL */}
          {panel === "stash" && (
            <Panel title="🎒 Stash" onClose={() => setPanel("none")} wide>
              {state.stash.length === 0 ? (
                <div style={{ color: "#666", textAlign: "center", padding: 24 }}>No product yet. Go grow some!</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 400, overflowY: "auto" }}>
                  {state.stash.map((entry, i) => {
                    const strain = getStrain(entry.strainId);
                    if (!strain) return null;
                    return (
                      <div key={i} style={{ background: "#1e2e1e", border: `1px solid ${colorHex(strain.color)}`, borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ color: colorHex(strain.color), fontWeight: "bold" }}>{strain.name}</span>
                          <span style={{ color: "#ffd700" }}>{entry.grams}g</span>
                        </div>
                        <div style={{ color: "#aaa", fontSize: 12 }}>Quality: <b style={{ color: "#fff" }}>{entry.quality}%</b> | Packaging: <b>{entry.packaging}</b></div>
                        <div style={{ color: "#888", fontSize: 11 }}>Est. value: ~${Math.round(strain.sellPricePerG * entry.grams * (entry.quality / 100))}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* PHONE PANEL */}
          {panel === "phone" && (
            <Panel title="📱 Contacts" onClose={() => setPanel("none")}>
              {state.unlockedCustomers.length === 0 ? (
                <div style={{ color: "#666" }}>No contacts yet. Level up to unlock them.</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {CUSTOMERS.filter(c => state.unlockedCustomers.includes(c.id)).map(c => {
                    const saved = state.customers.find(sc => sc.id === c.id);
                    const cooldownLeft = saved ? Math.max(0, c.cooldownMins - (state.gameMins - (saved.lastBoughtAt ?? 0))) : 0;
                    return (
                      <div key={c.id} style={{ background: "#1e1e2e", border: "1px solid #444", borderRadius: 8, padding: "10px 14px" }}>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontWeight: "bold", color: "#fff" }}>{c.avatar} {c.name}</span>
                          <span style={{ color: "#ffd700", fontSize: 12 }}>{Math.round(c.priceMultiplier * 100)}% price</span>
                        </div>
                        <div style={{ color: "#aaa", fontSize: 11, marginTop: 4 }}>{c.dialogue.greeting}</div>
                        <div style={{ color: "#888", fontSize: 11 }}>Buys: {c.preferredRarities.join(", ")} | Max {c.maxGrams}g | Min quality {c.minQuality}%</div>
                        {cooldownLeft > 0 ? (
                          <div style={{ color: "#ff9800", fontSize: 11, marginTop: 4 }}>⏳ Available in {cooldownLeft} game minutes</div>
                        ) : (
                          <button onClick={() => { setSellCustomerId(c.id); setPanel("sell"); }} style={{ marginTop: 6, padding: "4px 10px", background: "#1b5e20", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12 }}>Deal</button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {/* SELL PANEL */}
          {panel === "sell" && sellCustomerId && (() => {
            const customer = CUSTOMERS.find(c => c.id === sellCustomerId);
            if (!customer) return null;
            const availableStash = state.stash.filter(s => {
              const strain = getStrain(s.strainId);
              if (!strain) return false;
              return customer.preferredRarities.includes(strain.rarity) && s.quality >= customer.minQuality;
            });
            const entry = availableStash.find(s => s.strainId === sellStrainId) ?? availableStash[0];
            const strain = entry ? getStrain(entry.strainId) : null;
            const packBonuses: Record<string, number> = { zip: 1, jar: 1.1, luxury: 1.25, weed_pack: 1.4 };
            const basePrice = strain && entry ? strain.sellPricePerG * customer.priceMultiplier * (entry.quality / 100) * sellGrams * (packBonuses[packagingType] ?? 1) : 0;
            const totalPrice = Math.round(basePrice);
            const savedCust = state.customers.find(c => c.id === sellCustomerId);
            const cooldownLeft = savedCust ? Math.max(0, customer.cooldownMins - (state.gameMins - (savedCust.lastBoughtAt ?? 0))) : 0;
            return (
              <Panel title={`Deal with ${customer.avatar} ${customer.name}`} onClose={() => setPanel("none")}>
                <div style={{ color: "#aaa", fontSize: 13, marginBottom: 12, fontStyle: "italic" }}>"{customer.dialogue.greeting}"</div>
                {availableStash.length === 0 ? (
                  <div style={{ color: "#ff5252" }}>Nothing in your stash that they'll buy.</div>
                ) : cooldownLeft > 0 ? (
                  <div style={{ color: "#ff9800" }}>⏳ Not available for {cooldownLeft} more game minutes.</div>
                ) : (
                  <>
                    <div style={{ marginBottom: 8 }}>
                      <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 4 }}>Select strain:</label>
                      <select value={entry?.strainId ?? ""} onChange={e => setSellStrainId(e.target.value)} style={{ background: "#333", color: "#fff", border: "1px solid #555", padding: "6px 10px", borderRadius: 4, width: "100%", fontSize: 13 }}>
                        {availableStash.map(s => {
                          const st = getStrain(s.strainId);
                          return <option key={`${s.strainId}_${s.quality}`} value={s.strainId}>{st?.name} — {s.grams}g @ {s.quality}% quality</option>;
                        })}
                      </select>
                    </div>
                    {entry && (
                      <>
                        <div style={{ marginBottom: 8 }}>
                          <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 4 }}>Grams (max {Math.min(entry.grams, customer.maxGrams)}):</label>
                          <input type="range" min={1} max={Math.min(entry.grams, customer.maxGrams)} value={sellGrams} onChange={e => setSellGrams(Number(e.target.value))} style={{ width: "100%" }} />
                          <div style={{ color: "#fff", textAlign: "center" }}>{sellGrams}g</div>
                        </div>
                        <div style={{ marginBottom: 12 }}>
                          <label style={{ color: "#aaa", fontSize: 13, display: "block", marginBottom: 4 }}>Packaging:</label>
                          <div style={{ display: "flex", gap: 6 }}>
                            {[
                              { id: "zip", label: "Zip Bag", req: "zip_bags" },
                              { id: "jar", label: "Mason Jar", req: "mason_jars" },
                              { id: "luxury", label: "Luxury Box", req: "luxury_box" },
                              { id: "weed_pack", label: "$WEED Pack", req: "token_pack" },
                            ].map(p => {
                              const hasIt = (state.inventory[p.req] ?? 0) > 0;
                              return <button key={p.id} onClick={() => hasIt && setPackagingType(p.id)} style={{ padding: "4px 8px", background: packagingType === p.id ? "#4caf50" : hasIt ? "#333" : "#1a1a1a", color: hasIt ? "#fff" : "#666", border: "none", borderRadius: 4, cursor: hasIt ? "pointer" : "not-allowed", fontSize: 11 }}>{p.label}</button>;
                            })}
                          </div>
                        </div>
                        <div style={{ background: "#1e2e1e", padding: "10px 14px", borderRadius: 8, marginBottom: 12 }}>
                          <div style={{ color: "#aaa", fontSize: 12 }}>Price per gram: <b style={{ color: "#fff" }}>${(totalPrice / sellGrams).toFixed(2)}</b></div>
                          <div style={{ color: "#ffd700", fontSize: 18, fontWeight: "bold" }}>Total: ${totalPrice}</div>
                        </div>
                        <button onClick={() => {
                          EventBus.emit("action:sell", {
                            strainId: entry.strainId,
                            grams: sellGrams,
                            quality: entry.quality,
                            packaging: packagingType,
                            customerId: sellCustomerId,
                          });
                          setPanel("none");
                        }} style={{ width: "100%", padding: "10px", background: "#4caf50", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 15, fontWeight: "bold" }}>
                          💰 Sell {sellGrams}g for ${totalPrice}
                        </button>
                      </>
                    )}
                  </>
                )}
              </Panel>
            );
          })()}

        </div>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0; transform: translateY(-10px); } to { opacity: 1; transform: translateY(0); } }
        button:hover { filter: brightness(1.15); }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-thumb { background: #555; border-radius: 3px; }
      `}</style>
    </div>
  );
}

function Btn({ label, onClick, active, color }: { label: string; onClick: () => void; active?: boolean; color?: string }) {
  return (
    <button onClick={onClick} style={{ padding: "8px 16px", background: active ? "#4caf50" : (color ?? "#333"), color: "#fff", border: `1px solid ${active ? "#4caf50" : "#555"}`, borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: active ? "bold" : "normal" }}>
      {label}
    </button>
  );
}

function ActionBtn({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{ padding: "8px 14px", background: color ? "#1a2e1a" : "#1e1e2e", border: `1px solid ${color ?? "#555"}`, color: color ?? "#fff", borderRadius: 6, cursor: "pointer", fontSize: 13, textAlign: "left" }}>
      {label}
    </button>
  );
}

function Panel({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div onClick={e => e.stopPropagation()} style={{ background: "#1e1e2e", border: "1px solid #444", borderRadius: 12, padding: 20, width: wide ? 600 : 380, maxHeight: "80vh", overflowY: "auto", color: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontWeight: "bold", fontSize: 18 }}>{title}</div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer" }}>✕</button>
      </div>
      {children}
    </div>
  );
}
