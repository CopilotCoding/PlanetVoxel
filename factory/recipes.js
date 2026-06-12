// All production recipes

export const RECIPES = {
  crusher: [
    { inputs: { 'Iron Ore': 1 },    outputs: { 'Iron Chunk': 1 },    time: 1.0  },
    { inputs: { 'Copper Ore': 1 },  outputs: { 'Copper Chunk': 1 },  time: 1.0  },
    { inputs: { 'Titanium': 1 },    outputs: { 'Titanium Chunk': 1 },time: 1.5  },
  ],
  smelter: [
    { inputs: { 'Iron Chunk': 2,    Coal: 1 }, outputs: { 'Iron Ingot': 1 },     time: 2.0 },
    { inputs: { 'Copper Chunk': 2,  Coal: 1 }, outputs: { 'Copper Ingot': 1 },   time: 2.0 },
    { inputs: { 'Titanium Chunk': 2,Coal: 1 }, outputs: { 'Titanium Ingot': 1 }, time: 3.0 },
  ],
  fabricator: [
    { inputs: { 'Iron Ingot': 2,   'Copper Ingot': 1 },               outputs: { 'Circuit Board': 1 },  time: 3.0  },
    { inputs: { 'Iron Ingot': 3,   'Titanium Ingot': 1 },             outputs: { 'Alloy Plate': 1 },    time: 4.0  },
    { inputs: { 'Copper Ingot': 2, 'Coal': 1 },                       outputs: { 'Power Cell': 1 },     time: 2.5  },
  ],
  assembler: [
    { inputs: { 'Circuit Board': 2, 'Titanium Ingot': 1 },            outputs: { 'Processor': 1 },      time: 5.0 },
    { inputs: { 'Alloy Plate': 2,   'Power Cell': 1 },                outputs: { 'Quantum Chip': 1 },   time: 10.0 },
  ],
};

export function getRecipesFor(buildingType) {
  return RECIPES[buildingType] || [];
}

export function findRecipe(buildingType, inputItems) {
  const recipes = getRecipesFor(buildingType);
  for (const recipe of recipes) {
    let match = true;
    for (const [item, count] of Object.entries(recipe.inputs)) {
      if ((inputItems[item] || 0) < count) { match = false; break; }
    }
    if (match) return recipe;
  }
  return null;
}
