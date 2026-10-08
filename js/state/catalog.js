
import { hasOwn, sanitizeText } from '../domain/model.js';
import { DEFAULT_SECTION_B_MM, DEFAULT_SECTION_H_MM } from '../constants.js';
import { positiveNumber as sanitizePositiveNumber } from '../geometry-utils.js';
import { calculateSurfaceUnitWeight } from '../surface-weight.js';

import {
  cloneSection,
  DEFAULT_MATERIAL_DEFINITIONS,
  DEFAULT_MATERIAL_NAME_SET,
  DEFAULT_SECTION_NAME_SET,
  DEFAULT_SPRING_SYMBOL_SET,
  defaultColorForSection,
  isSameMaterialDefinition,
  normalizeCatalogSectionEntry,
  normalizeMaterialEntry,
  normalizeMemberEndInfo,
  normalizeSectionType,
  normalizeSpringEntry,
  sanitizeColor,
  surfaceSpringSymbols,
} from '../section-catalog.js';

function refreshSurfaceWeightsForMaterial(state, materialName) {
  for (const surface of state.surfaces) {
    const section = state._getSectionRef('surface', surface.type, surface.sectionName);
    if (section?.material !== materialName) continue;
    const unitWeight = calculateSurfaceUnitWeight(section, state._getMaterialRef(materialName));
    if (unitWeight !== null) surface.unitWeight = unitWeight;
  }
}

// Catalog lifecycle, lookup, and propagation to model elements.
// AppState delegates with its existing receiver and public method names.
export const catalogState = {
  _normalizeSectionType(target, type) {
    return normalizeSectionType(target, type);
  },

  _getSectionRef(target, type, name) {
    const normalizedType = this._normalizeSectionType(target, type);
    return this.sectionCatalog.find(s => s.target === target && s.type === normalizedType && s.name === name) || null;
  },

  getSection(target, type, name) {
    const section = this._getSectionRef(target, type, name);
    return section ? cloneSection(section) : null;
  },

  listSections(target, type) {
    const normalizedType = this._normalizeSectionType(target, type);
    return this.sectionCatalog
      .filter(s => s.target === target && s.type === normalizedType)
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.name.localeCompare(b.name);
      })
      .map(s => cloneSection(s));
  },

  getDefaultSectionName(target, type) {
    const normalizedType = this._normalizeSectionType(target, type);
    const section = this.sectionCatalog.find(
      s => s.target === target && s.type === normalizedType && s.isDefault
    );
    return section?.name || null;
  },

  getDefaultSection(target, type) {
    const name = this.getDefaultSectionName(target, type);
    return name ? this.getSection(target, type, name) : null;
  },

  addSection(entry) {
    const normalized = normalizeCatalogSectionEntry(entry);
    if (!normalized) return null;
    if (normalized.name.startsWith('_')) return null;
    if (DEFAULT_SECTION_NAME_SET.has(normalized.name)) return null;
    if (this._getSectionRef(normalized.target, normalized.type, normalized.name)) return null;
    const section = { ...normalized, isDefault: false };
    this._normalizeSectionEndDefaults(section);
    this.sectionCatalog.push(section);
    this._touch();
    return cloneSection(section);
  },

  updateSection(target, type, name, props = {}) {
    const normalizedType = this._normalizeSectionType(target, type);
    const section = this.sectionCatalog.find(
      s => s.target === target && s.type === normalizedType && s.name === name
    );
    if (!section || section.isDefault) return null;

    if (target === 'member') {
      // Use the same complete normalizer as add/load. This keeps shape
      // dimensions, effective shear-area ratios, and legacy b/h/property
      // edits mutually consistent instead of applying field patches that can
      // leave an invalid H or box section in the catalog.
      const candidate = {
        ...section,
        ...props,
        target: 'member',
        type: normalizedType,
        name: section.name,
      };
      for (const dimension of ['b', 'h']) {
        if (hasOwn(props, dimension) && (props[dimension] === '' || props[dimension] === null || props[dimension] === undefined)) {
          candidate[dimension] = section[dimension];
        }
      }
      let normalized;
      try {
        normalized = normalizeCatalogSectionEntry(candidate);
      } catch {
        return null;
      }
      if (!normalized) return null;
      Object.assign(section, normalized);
      this._normalizeSectionEndDefaults(section);
    } else {
      let normalized;
      try {
        const candidate = {
          ...section, ...props, target: 'surface', type: normalizedType, name: section.name,
        };
        if (props.edgeSprings && typeof props.edgeSprings === 'object' && !Array.isArray(props.edgeSprings)) {
          candidate.edgeSprings = { ...section.edgeSprings, ...props.edgeSprings };
        }
        normalized = normalizeCatalogSectionEntry(candidate);
      } catch {
        return null;
      }
      if (!normalized) return null;
      Object.assign(section, normalized);
    }

    if (target === 'member') {
      for (const member of this.members) {
        if (this._normalizeSectionType('member', member.type) === normalizedType && member.sectionName === name) {
          this._applyMemberSection(member, name);
        }
      }
    } else {
      for (const surface of this.surfaces) {
        if (this._normalizeSectionType('surface', surface.type) === normalizedType && surface.sectionName === name) {
          this._ensureSurfaceSection(surface, name);
        }
      }
    }

    this._touch();
    return cloneSection(section);
  },

  removeSection(target, type, name) {
    const normalizedType = this._normalizeSectionType(target, type);
    const idx = this.sectionCatalog.findIndex(
      s => s.target === target && s.type === normalizedType && s.name === name
    );
    if (idx < 0) return false;
    if (this.sectionCatalog[idx].isDefault) return false;

    if (target === 'member') {
      const inUse = this.members.some(
        m => this._normalizeSectionType('member', m.type) === normalizedType && m.sectionName === name
      );
      if (inUse) return false;
    } else {
      const inUse = this.surfaces.some(
        s => this._normalizeSectionType('surface', s.type) === normalizedType && s.sectionName === name
      );
      if (inUse) return false;
    }

    this.sectionCatalog.splice(idx, 1);
    this._touch();
    return true;
  },

  _getSpringRef(symbol) {
    return this.springCatalog.find(s => s.symbol === symbol) || null;
  },

  getSpring(symbol) {
    const spring = this._getSpringRef(symbol);
    return spring ? { ...spring } : null;
  },

  listSprings() {
    return this.springCatalog
      .slice()
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return a.symbol.localeCompare(b.symbol);
      })
      .map(s => ({ ...s }));
  },

  addSpring(entry) {
    const normalized = normalizeSpringEntry(entry);
    if (!normalized) return null;
    if (normalized.symbol.startsWith('_')) return null;
    if (DEFAULT_SPRING_SYMBOL_SET.has(normalized.symbol)) return null;
    if (this._getSpringRef(normalized.symbol)) return null;
    const spring = { ...normalized, isDefault: false };
    this.springCatalog.push(spring);
    this._touch();
    return { ...spring };
  },

  updateSpring(symbol, props = {}) {
    const spring = this._getSpringRef(symbol);
    if (!spring || spring.isDefault) return null;
    let normalized;
    try {
      normalized = normalizeSpringEntry({ ...spring, ...props, symbol });
    } catch {
      return null;
    }
    if (!normalized) return null;
    Object.assign(spring, normalized);
    this._touch();
    return { ...spring };
  },

  removeSpring(symbol) {
    const idx = this.springCatalog.findIndex(s => s.symbol === symbol);
    if (idx < 0) return false;
    if (this.springCatalog[idx].isDefault) return false;
    const inUse = this.members.some(m =>
      (m.endI?.condition === 'spring' && m.endI.springSymbol === symbol) ||
      (m.endJ?.condition === 'spring' && m.endJ.springSymbol === symbol)
    );
    if (inUse) return false;
    const inSectionPreset = this.sectionCatalog.some(s =>
      (s.target === 'surface' && surfaceSpringSymbols(s).includes(symbol)) || (s.target === 'member' && (
        (s.defaultEndI?.condition === 'spring' && s.defaultEndI.springSymbol === symbol) ||
        (s.defaultEndJ?.condition === 'spring' && s.defaultEndJ.springSymbol === symbol)
      ))
    );
    if (inSectionPreset) return false;
    this.springCatalog.splice(idx, 1);
    this._touch();
    return true;
  },

  _getMaterialRef(name) {
    return this.materialCatalog.find(material => material.name === name) || null;
  },

  getMaterial(name) {
    const material = this._getMaterialRef(name);
    return material ? { ...material } : null;
  },

  listMaterials() {
    return this.materialCatalog
      .slice()
      .sort((a, b) => {
        const aDefaultIndex = DEFAULT_MATERIAL_DEFINITIONS.findIndex(item => item.name === a.name);
        const bDefaultIndex = DEFAULT_MATERIAL_DEFINITIONS.findIndex(item => item.name === b.name);
        if (aDefaultIndex >= 0 || bDefaultIndex >= 0) {
          if (aDefaultIndex < 0) return 1;
          if (bDefaultIndex < 0) return -1;
          return aDefaultIndex - bDefaultIndex;
        }
        return a.name.localeCompare(b.name);
      })
      .map(material => ({ ...material }));
  },

  addMaterial(entry) {
    const normalized = normalizeMaterialEntry(entry);
    if (!normalized || normalized.name.startsWith('_')) return null;
    if (this._getMaterialRef(normalized.name)) return null;
    const material = { ...normalized, isDefault: false };
    this.materialCatalog.push(material);
    refreshSurfaceWeightsForMaterial(this, material.name);
    this._touch();
    return { ...material };
  },

  updateMaterial(name, props = {}) {
    const material = this._getMaterialRef(name);
    if (!material) return null;
    const normalized = normalizeMaterialEntry({ ...material, ...props, name });
    if (!normalized) return null;
    const defaultDefinition = DEFAULT_MATERIAL_DEFINITIONS.find(item => item.name === name);
    Object.assign(material, normalized, {
      isDefault: Boolean(defaultDefinition && isSameMaterialDefinition(defaultDefinition, normalized)),
    });
    refreshSurfaceWeightsForMaterial(this, name);
    this._touch();
    return { ...material };
  },

  removeMaterial(name) {
    if (DEFAULT_MATERIAL_NAME_SET.has(name)) return false;
    const index = this.materialCatalog.findIndex(material => material.name === name);
    if (index < 0) return false;
    const inUse = this.sectionCatalog.some(
      section => section.material === name
    );
    if (inUse) return false;
    this.materialCatalog.splice(index, 1);
    this._touch();
    return true;
  },

  _nextCustomSectionName(target, type) {
    const normalizedType = this._normalizeSectionType(target, type);
    let idx = 1;
    while (idx < 100000) {
      const candidate = `U${idx}`;
      const exists = this.sectionCatalog.some(
        s => s.target === target && s.type === normalizedType && s.name === candidate
      );
      if (!exists && !DEFAULT_SECTION_NAME_SET.has(candidate)) return candidate;
      idx++;
    }
    return `U${Date.now()}`;
  },

  _findMemberSectionBySpec(memberType, material, b, h, color = null) {
    const normalizedType = this._normalizeSectionType('member', memberType);
    const targetMaterial = sanitizeText(material) || 'steel';
    const targetB = sanitizePositiveNumber(b, DEFAULT_SECTION_B_MM);
    const targetH = sanitizePositiveNumber(h, DEFAULT_SECTION_H_MM);
    const targetColor = sanitizeColor(color, defaultColorForSection('member', normalizedType));
    return this.sectionCatalog.find(s =>
      s.target === 'member' &&
      s.type === normalizedType &&
      (s.material || 'steel') === targetMaterial &&
      sanitizePositiveNumber(s.b, DEFAULT_SECTION_B_MM) === targetB &&
      sanitizePositiveNumber(s.h, DEFAULT_SECTION_H_MM) === targetH &&
      sanitizeColor(s.color, defaultColorForSection('member', normalizedType)) === targetColor
    ) || null;
  },

  _createImportedMemberSection(memberType, material, b, h, color = null) {
    const normalizedType = this._normalizeSectionType('member', memberType);
    const section = {
      ...normalizeCatalogSectionEntry({
        target: 'member',
        type: normalizedType,
        name: this._nextCustomSectionName('member', normalizedType),
        material: sanitizeText(material) || 'steel',
        b: sanitizePositiveNumber(b, DEFAULT_SECTION_B_MM),
        h: sanitizePositiveNumber(h, DEFAULT_SECTION_H_MM),
        color: sanitizeColor(color, defaultColorForSection('member', normalizedType)),
      }),
      isDefault: false,
    };
    this.sectionCatalog.push(section);
    return section;
  },

  _applyMemberSection(member, sectionName) {
    const section = this._getSectionRef('member', member.type, sectionName);
    if (!section) return false;
    member.sectionName = section.name;
    member.material = section.material || 'steel';
    member.section = {
      b: sanitizePositiveNumber(section.b, DEFAULT_SECTION_B_MM),
      h: sanitizePositiveNumber(section.h, DEFAULT_SECTION_H_MM),
    };
    member.color = sanitizeColor(section.color, defaultColorForSection('member', member.type));
    return true;
  },

  _ensureMemberSection(member, requestedSectionName = null) {
    const normalizedType = this._normalizeSectionType('member', member.type);
    const sectionName = sanitizeText(requestedSectionName || member.sectionName);
    let section = sectionName
      ? this._getSectionRef('member', normalizedType, sectionName)
      : null;

    if (!section) {
      const defaultName = this.getDefaultSectionName('member', normalizedType);
      section = defaultName ? this._getSectionRef('member', normalizedType, defaultName) : null;
    }
    if (!section) {
      section = this.sectionCatalog.find(s => s.target === 'member' && s.type === normalizedType) || null;
    }

    if (section && this._applyMemberSection(member, section.name)) return;

    member.sectionName = sectionName || '';
    member.material = sanitizeText(member.material) || 'steel';
    member.section = {
      b: sanitizePositiveNumber(member.section?.b, DEFAULT_SECTION_B_MM),
      h: sanitizePositiveNumber(member.section?.h, DEFAULT_SECTION_H_MM),
    };
    member.color = sanitizeColor(member.color, defaultColorForSection('member', member.type));
  },

  _getMemberSectionEndDefaults(member) {
    const section = this._getSectionRef('member', member.type, member.sectionName);
    return {
      endI: this._normalizeMemberEnd(section?.defaultEndI),
      endJ: this._normalizeMemberEnd(section?.defaultEndJ),
    };
  },

  _normalizeSectionEndDefaults(section) {
    if (section?.target !== 'member') return;
    section.defaultEndI = this._normalizeMemberEnd(section.defaultEndI);
    section.defaultEndJ = this._normalizeMemberEnd(section.defaultEndJ);
  },

  _normalizeSectionCatalogEndDefaults() {
    for (const section of this.sectionCatalog) {
      this._normalizeSectionEndDefaults(section);
    }
  },

  _ensureSurfaceSection(surface, requestedSectionName = null) {
    const normalizedType = this._normalizeSectionType('surface', surface.type);
    const sectionName = sanitizeText(requestedSectionName || surface.sectionName);
    let section = sectionName
      ? this._getSectionRef('surface', normalizedType, sectionName)
      : null;

    if (!section) {
      const defaultName = this.getDefaultSectionName('surface', normalizedType);
      section = defaultName ? this._getSectionRef('surface', normalizedType, defaultName) : null;
    }
    if (!section) {
      section = this.sectionCatalog.find(s => s.target === 'surface' && s.type === normalizedType) || null;
    }

    surface.sectionName = section?.name || sectionName || '';
    surface.color = sanitizeColor(
      section?.color || surface.color,
      defaultColorForSection('surface', surface.type)
    );
    const unitWeight = calculateSurfaceUnitWeight(section, this._getMaterialRef(section?.material));
    if (unitWeight !== null) surface.unitWeight = unitWeight;
  },

  _normalizeMemberEnd(endInfo) {
    return normalizeMemberEndInfo(endInfo, this.springCatalog);
  }
};
