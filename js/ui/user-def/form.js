// Definition creation form, defaults, validation and calculated-property preview.
import { t } from '../../i18n.js';
import { escapeHtml, markInputInvalid, clearInputInvalid } from '../../dom-utils.js';
import { showNotice } from '../../notice.js';
import { calculateSectionPropertiesFromShape, normalizeSectionShape } from '../../section-catalog.js';
import { END_CONDITIONS, applyI18nTo, syncEndSpringVisibility, readEndPreset, readOptionalPositiveInput, readOptionalNonNegativeInput, readSpringStiffnessInput, readRequiredPositiveInput, readOptionalRatioInput, readSectionShapeInputs, calculatedIntegerProperties, applyCalculatedProperties, surfaceWeightFeedback } from './fields.js';

export function createUserDefForm({ state, commands, onModelChange, refreshDraftSectionSelectors, onGroupChange }) {
  const userDefModal = document.getElementById('user-def-modal');
  const userDefKindSelect = document.getElementById('user-def-kind');
  const userDefTargetSelect = document.getElementById('user-def-target');
  const userDefTypeSelect = document.getElementById('user-def-type');
  const userDefSectionGroup = document.getElementById('user-def-section-group');
  const userDefSpringGroup = document.getElementById('user-def-spring-group');
  const userDefMaterialGroup = document.getElementById('user-def-material-group');
  const userDefSizeGroup = document.getElementById('user-def-size-group');
  const userDefSectionMaterialGroup = document.getElementById('user-def-section-material-group');
  const userDefSectionMaterialSelect = document.getElementById('user-def-section-material');
  const userDefPropertiesGroup = document.getElementById('user-def-properties-group');
  const userDefShapeGroup = document.getElementById('user-def-shape-group');
  const userDefShapeSelect = document.getElementById('user-def-shape');
  const userDefHShapeGroup = document.getElementById('user-def-h-shape-group');
  const userDefBoxShapeGroup = document.getElementById('user-def-box-shape-group');
  const userDefFlangeThicknessInput = document.getElementById('user-def-flange-thickness');
  const userDefWebThicknessInput = document.getElementById('user-def-web-thickness');
  const userDefBoxThicknessInput = document.getElementById('user-def-box-thickness');
  const userDefShearAreaRatioGroup = document.getElementById('user-def-shear-area-ratio-group');
  const userDefShearAreaRatioYInput = document.getElementById('user-def-shear-area-ratio-y');
  const userDefShearAreaRatioZInput = document.getElementById('user-def-shear-area-ratio-z');
  const userDefNameInput = document.getElementById('user-def-name');
  const userDefColorInput = document.getElementById('user-def-color');
  const userDefBInput = document.getElementById('user-def-b');
  const userDefHInput = document.getElementById('user-def-h');
  const userDefAInput = document.getElementById('user-def-A');
  const userDefIyInput = document.getElementById('user-def-Iy');
  const userDefIzInput = document.getElementById('user-def-Iz');
  const userDefJInput = document.getElementById('user-def-J');
  const userDefAvyInput = document.getElementById('user-def-Avy');
  const userDefAvzInput = document.getElementById('user-def-Avz');
  const userDefDesignationInput = document.getElementById('user-def-designation');
  const userDefPropertySourceSelect = document.getElementById('user-def-property-source');
  const userDefSurfaceWeightGroup = document.getElementById('user-def-surface-weight-group');
  const userDefThicknessInput = document.getElementById('user-def-thickness');
  const userDefSelfWeightModeSelect = document.getElementById('user-def-self-weight-mode');
  const userDefAdditionalWeightInput = document.getElementById('user-def-additional-weight');
  const userDefSurfaceWeightPreview = document.getElementById('user-def-surface-weight-preview');
  const userDefEndPresetGroup = document.getElementById('user-def-end-preset-group');
  const userDefEndIConditionSelect = document.getElementById('user-def-endi-condition');
  const userDefEndJConditionSelect = document.getElementById('user-def-endj-condition');
  const userDefEndISpringSelect = document.getElementById('user-def-endi-spring');
  const userDefEndJSpringSelect = document.getElementById('user-def-endj-spring');
  const userDefSectionMemoInput = document.getElementById('user-def-section-memo');
  const userDefSymbolInput = document.getElementById('user-def-symbol');
  const userDefKrInput = document.getElementById('user-def-kr');
  const userDefKrYInput = document.getElementById('user-def-krY');
  const userDefKrZInput = document.getElementById('user-def-krZ');
  const userDefKtInput = document.getElementById('user-def-kt');
  const userDefMemoInput = document.getElementById('user-def-memo');
  const userDefMaterialNameInput = document.getElementById('user-def-material-name');
  const userDefEInput = document.getElementById('user-def-E');
  const userDefGInput = document.getElementById('user-def-G');
  const userDefDensityInput = document.getElementById('user-def-density');
  const userDefFormErrorEl = document.getElementById('user-def-form-error');

  // --- Form error display ---

  function clearUserDefFormError() {
    if (!userDefFormErrorEl) return;
    userDefFormErrorEl.hidden = true;
    userDefFormErrorEl.textContent = '';
    clearInputInvalid(userDefNameInput);
    clearInputInvalid(userDefBInput);
    clearInputInvalid(userDefHInput);
    clearInputInvalid(userDefFlangeThicknessInput);
    clearInputInvalid(userDefWebThicknessInput);
    clearInputInvalid(userDefBoxThicknessInput);
    clearInputInvalid(userDefShearAreaRatioYInput);
    clearInputInvalid(userDefShearAreaRatioZInput);
    clearInputInvalid(userDefSymbolInput);
    clearInputInvalid(userDefKrInput);
    clearInputInvalid(userDefKtInput);
    clearInputInvalid(userDefMaterialNameInput);
    clearInputInvalid(userDefEInput);
    clearInputInvalid(userDefGInput);
    clearInputInvalid(userDefDensityInput);
    for (const input of [userDefAInput, userDefIyInput, userDefIzInput, userDefJInput, userDefAvyInput, userDefAvzInput, userDefKrYInput, userDefKrZInput, userDefThicknessInput, userDefAdditionalWeightInput]) {
      clearInputInvalid(input);
    }
  }

  function showUserDefFormError(message, input) {
    if (!userDefFormErrorEl) {
      showNotice(message, 'error');
      return;
    }
    clearUserDefFormError();
    userDefFormErrorEl.textContent = message;
    userDefFormErrorEl.hidden = false;
    markInputInvalid(input);
  }

  // --- Form rendering ---

  function refreshUserDefTypeOptions() {
    if (!userDefTargetSelect || !userDefTypeSelect) return;
    const isMember = userDefTargetSelect.value === 'member';
    const options = isMember
      ? [
          { value: 'beam', label: t('beam') },
          { value: 'column', label: t('column') },
          { value: 'hbrace', label: t('hbrace') },
          { value: 'vbrace', label: t('vbrace') },
        ]
      : [
          { value: 'floor', label: t('floor') },
          { value: 'exteriorWall', label: t('exteriorWall') },
          { value: 'wall', label: t('wall') },
          { value: 'roof', label: t('roof') },
          { value: 'eave', label: t('eave') },
          { value: 'gableWall', label: t('gableWall') },
        ];
    userDefTypeSelect.innerHTML = options
      .map(o => `<option value="${o.value}">${escapeHtml(o.label)}</option>`)
      .join('');
    applyUserDefDefaultSectionValues();
  }

  function refreshUserDefFormVisibility() {
    const kind = userDefKindSelect?.value || 'section';
    const isSection = kind === 'section';
    const isSpring = kind === 'spring';
    if (userDefSectionGroup) userDefSectionGroup.style.display = isSection ? '' : 'none';
    if (userDefSpringGroup) userDefSpringGroup.hidden = !isSpring;
    if (userDefMaterialGroup) userDefMaterialGroup.hidden = kind !== 'material';
    const isMemberSection = isSection && userDefTargetSelect?.value === 'member';
    if (userDefSizeGroup) userDefSizeGroup.style.display = isMemberSection ? 'flex' : 'none';
    if (userDefShapeGroup) userDefShapeGroup.style.display = isMemberSection ? '' : 'none';
    if (userDefSectionMaterialGroup) userDefSectionMaterialGroup.style.display = isSection ? '' : 'none';
    if (userDefSurfaceWeightGroup) userDefSurfaceWeightGroup.hidden = !isSection || isMemberSection;
    if (userDefPropertiesGroup) userDefPropertiesGroup.style.display = isMemberSection ? '' : 'none';
    if (userDefShearAreaRatioGroup) userDefShearAreaRatioGroup.style.display = isMemberSection ? '' : 'none';
    if (userDefEndPresetGroup) userDefEndPresetGroup.style.display = isMemberSection ? 'flex' : 'none';
    refreshUserDefShapeVisibility(isMemberSection);
    refreshMaterialSelectOptions();
    refreshUserDefEndSpringVisibility();
    refreshSurfaceWeightPreview();
  }

  function refreshUserDefShapeVisibility(isMemberSection = userDefTargetSelect?.value === 'member') {
    const shape = normalizeSectionShape(userDefShapeSelect?.value);
    if (userDefHShapeGroup) userDefHShapeGroup.hidden = !isMemberSection || shape !== 'hSection';
    if (userDefBoxShapeGroup) userDefBoxShapeGroup.hidden = !isMemberSection || shape !== 'boxSection';
  }

  function refreshMaterialSelectOptions(selectedName = null) {
    if (!userDefSectionMaterialSelect) return;
    const materials = state.listMaterials();
    const isSurface = userDefTargetSelect?.value === 'surface';
    const selected = selectedName ?? (userDefSectionMaterialSelect.value || (isSurface ? '' : materials[0]?.name || 'steel'));
    const missingOption = selected && !materials.some(material => material.name === selected)
      ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (${escapeHtml(t('userDefMaterialMissing'))})</option>` : '';
    userDefSectionMaterialSelect.innerHTML = (isSurface ? `<option value="">${escapeHtml(t('userDefUnspecified'))}</option>` : '') + missingOption + materials.map(material =>
      `<option value="${escapeHtml(material.name)}" ${material.name === selected ? 'selected' : ''}>${escapeHtml(t(material.name) === material.name ? material.name : t(material.name))}</option>`
    ).join('');
    userDefSectionMaterialSelect.value = selected;
    refreshSurfaceWeightPreview();
  }

  function refreshSurfaceWeightPreview() {
    if (!userDefSurfaceWeightPreview) return;
    userDefSurfaceWeightPreview.textContent = surfaceWeightFeedback({
      selfWeightMode: userDefSelfWeightModeSelect?.value || null,
      thickness: readOptionalPositiveInput(userDefThicknessInput).value,
      additionalWeight: readOptionalNonNegativeInput(userDefAdditionalWeightInput).value,
    }, state.getMaterial(userDefSectionMaterialSelect?.value));
  }

  function getUserDefGroupDefaultSection(target, type) {
    return state.getDefaultSection(target, type) || state.listSections(target, type)[0] || null;
  }

  function applyUserDefDefaultSectionValues() {
    if (!userDefColorInput || !userDefTargetSelect || !userDefTypeSelect) return;
    const target = userDefTargetSelect.value || 'member';
    const type = userDefTypeSelect.value || '';
    const section = getUserDefGroupDefaultSection(target, type);
    if (section?.color) {
      userDefColorInput.value = section.color;
    } else if (target === 'surface') {
      userDefColorInput.value = type === 'floor' ? '#67a9cf' : (
        type === 'roof' ? '#8b6f47' : (type === 'eave' ? '#4f9a8a' : (type === 'gableWall' ? '#bf6f5e' : '#b57a6b'))
      );
    } else {
      userDefColorInput.value = '#666666';
    }
    if (target === 'member') {
      if (userDefBInput) userDefBInput.value = String(section?.b || 200);
      if (userDefHInput) userDefHInput.value = String(section?.h || 400);
      if (userDefShapeSelect) userDefShapeSelect.value = normalizeSectionShape(section?.shape);
      if (userDefFlangeThicknessInput) userDefFlangeThicknessInput.value = section?.flangeThickness ?? '';
      if (userDefWebThicknessInput) userDefWebThicknessInput.value = section?.webThickness ?? '';
      if (userDefBoxThicknessInput) userDefBoxThicknessInput.value = section?.boxThickness ?? '';
      if (userDefShearAreaRatioYInput) userDefShearAreaRatioYInput.value = section?.shearAreaRatioY ?? '';
      if (userDefShearAreaRatioZInput) userDefShearAreaRatioZInput.value = section?.shearAreaRatioZ ?? '';
      refreshMaterialSelectOptions(section?.material || 'steel');
      setUserDefEndPresetInputs(section?.defaultEndI, section?.defaultEndJ);
      refreshUserDefShapeVisibility();
    } else {
      refreshMaterialSelectOptions(section?.material || '');
      if (userDefThicknessInput) userDefThicknessInput.value = section?.thickness ?? '';
      if (userDefSelfWeightModeSelect) userDefSelfWeightModeSelect.value = section?.selfWeightMode || '';
      if (userDefAdditionalWeightInput) userDefAdditionalWeightInput.value = section?.additionalWeight ?? '';
      refreshSurfaceWeightPreview();
    }
  }

  function setUserDefEndPresetInputs(defaultEndI = null, defaultEndJ = null) {
    setEndPresetInput(userDefEndIConditionSelect, userDefEndISpringSelect, defaultEndI);
    setEndPresetInput(userDefEndJConditionSelect, userDefEndJSpringSelect, defaultEndJ);
    refreshUserDefEndSpringVisibility();
  }

  function setEndPresetInput(conditionEl, springEl, endInfo = null) {
    if (!conditionEl) return;
    const condition = END_CONDITIONS.includes(endInfo?.condition) ? endInfo.condition : 'pin';
    conditionEl.value = condition;
    refreshSpringSelectOptions(springEl, endInfo?.springSymbol || '');
  }

  function refreshSpringSelectOptions(selectEl, selectedSymbol = '') {
    if (!selectEl) return;
    const springs = state.listSprings();
    const fallbackSymbol = springs[0]?.symbol || '';
    const selected = selectedSymbol || selectEl.value || fallbackSymbol;
    selectEl.innerHTML = springs.map(s =>
      `<option value="${escapeHtml(s.symbol)}" ${s.symbol === selected ? 'selected' : ''}>${escapeHtml(s.symbol)}</option>`
    ).join('');
    if (selected && springs.some(s => s.symbol === selected)) selectEl.value = selected;
  }

  function refreshUserDefEndSpringVisibility() {
    refreshSpringSelectOptions(userDefEndISpringSelect);
    refreshSpringSelectOptions(userDefEndJSpringSelect);
    syncEndSpringVisibility(userDefEndIConditionSelect, userDefEndISpringSelect);
    syncEndSpringVisibility(userDefEndJConditionSelect, userDefEndJSpringSelect);
  }

  // --- Form actions ---

  function resetUserDefForm() {
    clearUserDefFormError();
    if (userDefKindSelect) userDefKindSelect.value = 'section';
    if (userDefTargetSelect) userDefTargetSelect.value = 'member';
    if (userDefNameInput) userDefNameInput.value = '';
    if (userDefColorInput) userDefColorInput.value = '#666666';
    if (userDefBInput) userDefBInput.value = '200';
    if (userDefHInput) userDefHInput.value = '400';
    for (const input of [userDefAInput, userDefIyInput, userDefIzInput, userDefJInput, userDefAvyInput, userDefAvzInput, userDefDesignationInput, userDefPropertySourceSelect, userDefKrYInput, userDefKrZInput, userDefThicknessInput, userDefSelfWeightModeSelect, userDefAdditionalWeightInput]) {
      if (input) input.value = '';
    }
    if (userDefSectionMemoInput) userDefSectionMemoInput.value = '';
    if (userDefSymbolInput) userDefSymbolInput.value = '';
    if (userDefKrInput) userDefKrInput.value = '';
    if (userDefKtInput) userDefKtInput.value = '';
    if (userDefMemoInput) userDefMemoInput.value = '';
    if (userDefMaterialNameInput) userDefMaterialNameInput.value = '';
    if (userDefEInput) userDefEInput.value = '';
    if (userDefGInput) userDefGInput.value = '';
    if (userDefDensityInput) userDefDensityInput.value = '';
    refreshUserDefTypeOptions();
    refreshUserDefFormVisibility();
  }

  function showUserDefModal() {
    clearUserDefFormError();
    applyI18nTo(userDefModal);
    refreshUserDefTypeOptions();
    refreshUserDefFormVisibility();
    userDefModal.classList.add('visible');
  }

  function hideUserDefModal() {
    clearUserDefFormError();
    userDefModal.classList.remove('visible');
  }

  function calculateUserDefSectionProperties() {
    clearUserDefFormError();
    const b = readRequiredPositiveInput(userDefBInput);
    const h = readRequiredPositiveInput(userDefHInput);
    if (!b.valid || !h.valid) {
      showUserDefFormError(t('userDefInvalidSize'), !b.valid ? userDefBInput : userDefHInput);
      if (!b.valid && !h.valid) markInputInvalid(userDefHInput);
      return;
    }
    const shape = readSectionShapeInputs({
      shapeSelect: userDefShapeSelect,
      flangeThicknessInput: userDefFlangeThicknessInput,
      webThicknessInput: userDefWebThicknessInput,
      boxThicknessInput: userDefBoxThicknessInput,
    });
    if (!shape.valid) {
      showUserDefFormError(t('userDefInvalidShape'), shape.input);
      return;
    }
    const properties = calculatedIntegerProperties({ b: b.value, h: h.value, ...shape.value });
    if (!properties) {
      showUserDefFormError(t('userDefInvalidShape'), shape.input || userDefShapeSelect);
      return;
    }
    applyCalculatedProperties(properties, {
      A: userDefAInput,
      Iy: userDefIyInput,
      Iz: userDefIzInput,
      J: userDefJInput,
    });
    if (userDefPropertySourceSelect) userDefPropertySourceSelect.value = 'computed';
  }

  function addUserDefinition() {
    clearUserDefFormError();
    const kind = userDefKindSelect?.value || 'section';
    let added = null;

    if (kind === 'section') {
      const target = userDefTargetSelect?.value || 'member';
      const type = userDefTypeSelect?.value || '';
      const name = userDefNameInput?.value?.trim() || '';
      if (name.startsWith('_')) {
        showUserDefFormError(t('userDefNoLeadingUnderscore'), userDefNameInput);
        return;
      }
      const color = userDefColorInput?.value || '';
      const sectionMemo = userDefSectionMemoInput?.value?.trim() || '';
      if (target === 'member') {
        const b = readRequiredPositiveInput(userDefBInput);
        const h = readRequiredPositiveInput(userDefHInput);
        if (!b.valid || !h.valid) {
          showUserDefFormError(t('userDefInvalidSize'), userDefBInput);
          markInputInvalid(userDefHInput);
          return;
        }
        const shape = readSectionShapeInputs({
          shapeSelect: userDefShapeSelect,
          flangeThicknessInput: userDefFlangeThicknessInput,
          webThicknessInput: userDefWebThicknessInput,
          boxThicknessInput: userDefBoxThicknessInput,
        });
        if (!shape.valid || !calculateSectionPropertiesFromShape({ b: b.value, h: h.value, ...shape.value })) {
          showUserDefFormError(t('userDefInvalidShape'), shape.input || userDefShapeSelect);
          return;
        }
        const propertyInputs = {
          A: userDefAInput,
          Iy: userDefIyInput,
          Iz: userDefIzInput,
          J: userDefJInput,
          Avy: userDefAvyInput,
          Avz: userDefAvzInput,
        };
        const properties = {};
        for (const [property, input] of Object.entries(propertyInputs)) {
          const result = readOptionalPositiveInput(input);
          if (!result.valid) {
            showUserDefFormError(t('userDefInvalidProperty'), input);
            return;
          }
          properties[property] = result.value;
        }
        const shearAreaRatioY = readOptionalRatioInput(userDefShearAreaRatioYInput);
        const shearAreaRatioZ = readOptionalRatioInput(userDefShearAreaRatioZInput);
        if (!shearAreaRatioY.valid || !shearAreaRatioZ.valid) {
          showUserDefFormError(
            t('userDefInvalidShearAreaRatio'),
            !shearAreaRatioY.valid ? userDefShearAreaRatioYInput : userDefShearAreaRatioZInput
          );
          return;
        }
        added = commands.addSection({
          target,
          type,
          name,
          b: b.value,
          h: h.value,
          material: userDefSectionMaterialSelect?.value || 'steel',
          designation: userDefDesignationInput?.value?.trim() || null,
          propertySource: userDefPropertySourceSelect?.value || null,
          ...shape.value,
          ...properties,
          shearAreaRatioY: shearAreaRatioY.value,
          shearAreaRatioZ: shearAreaRatioZ.value,
          color,
          memo: sectionMemo,
          defaultEndI: readEndPreset(userDefEndIConditionSelect, userDefEndISpringSelect),
          defaultEndJ: readEndPreset(userDefEndJConditionSelect, userDefEndJSpringSelect),
        });
      } else {
        const thickness = readOptionalPositiveInput(userDefThicknessInput);
        const additionalWeight = readOptionalNonNegativeInput(userDefAdditionalWeightInput);
        if (!thickness.valid || !additionalWeight.valid) {
          showUserDefFormError(t('userDefInvalidSurfaceWeight'), !thickness.valid ? userDefThicknessInput : userDefAdditionalWeightInput);
          return;
        }
        added = commands.addSection({ target, type, name, color, memo: sectionMemo,
          material: userDefSectionMaterialSelect?.value || null,
          thickness: thickness.value,
          selfWeightMode: userDefSelfWeightModeSelect?.value || null,
          additionalWeight: additionalWeight.value,
        });
      }
    } else if (kind === 'spring') {
      const symbol = userDefSymbolInput?.value?.trim() || '';
      if (symbol.startsWith('_')) {
        showUserDefFormError(t('userDefNoLeadingUnderscore'), userDefSymbolInput);
        return;
      }
      const memo = userDefMemoInput?.value?.trim() || '';
      const stiffness = {};
      for (const [key, input] of Object.entries({ kr: userDefKrInput, krY: userDefKrYInput, krZ: userDefKrZInput, kt: userDefKtInput })) {
        const result = readSpringStiffnessInput(input);
        if (!result.valid) {
          showUserDefFormError(t('userDefInvalidStiffness'), input);
          return;
        }
        stiffness[key] = result.value;
      }
      added = commands.addSpring({ symbol, ...stiffness, memo });
    } else {
      const name = userDefMaterialNameInput?.value?.trim() || '';
      if (name.startsWith('_')) {
        showUserDefFormError(t('userDefNoLeadingUnderscore'), userDefMaterialNameInput);
        return;
      }
      const E = readRequiredPositiveInput(userDefEInput);
      const G = readRequiredPositiveInput(userDefGInput);
      const density = readRequiredPositiveInput(userDefDensityInput);
      if (!E.valid || !G.valid || !density.valid) {
        const invalid = !E.valid ? userDefEInput : (!G.valid ? userDefGInput : userDefDensityInput);
        showUserDefFormError(t('userDefInvalidMaterial'), invalid);
        return;
      }
      added = commands.addMaterial({ name, E: E.value, G: G.value, density: density.value });
    }

    if (!added) {
      const keyInput = kind === 'section'
        ? userDefNameInput
        : (kind === 'spring' ? userDefSymbolInput : userDefMaterialNameInput);
      showUserDefFormError(t('userDefAddFailed'), keyInput);
      return;
    }
    clearUserDefFormError();
    showNotice(t('userDefAdded'), 'success');
    onModelChange();
    refreshDraftSectionSelectors();
    resetUserDefForm();
    onGroupChange();
  }

  document.getElementById('btn-user-def-close').addEventListener('click', hideUserDefModal);
  document.getElementById('btn-user-def-add').addEventListener('click', addUserDefinition);
  document.getElementById('btn-user-def-calculate-properties')?.addEventListener('click', calculateUserDefSectionProperties);

  if (userDefKindSelect) userDefKindSelect.addEventListener('change', () => {
    clearUserDefFormError();
    refreshUserDefFormVisibility();
    onGroupChange();
  });
  if (userDefTargetSelect) userDefTargetSelect.addEventListener('change', () => {
    clearUserDefFormError();
    refreshUserDefTypeOptions();
    refreshUserDefFormVisibility();
    onGroupChange();
  });
  if (userDefTypeSelect) userDefTypeSelect.addEventListener('change', () => {
    clearUserDefFormError();
    applyUserDefDefaultSectionValues();
    onGroupChange();
  });
  if (userDefShapeSelect) userDefShapeSelect.addEventListener('change', () => {
    clearUserDefFormError();
    refreshUserDefShapeVisibility();
  });
  if (userDefEndIConditionSelect) userDefEndIConditionSelect.addEventListener('change', refreshUserDefEndSpringVisibility);
  if (userDefEndJConditionSelect) userDefEndJConditionSelect.addEventListener('change', refreshUserDefEndSpringVisibility);
  for (const input of [userDefSectionMaterialSelect, userDefThicknessInput, userDefSelfWeightModeSelect, userDefAdditionalWeightInput]) {
    input?.addEventListener('input', refreshSurfaceWeightPreview);
    input?.addEventListener('change', refreshSurfaceWeightPreview);
  }

  resetUserDefForm();
  return {
    show: showUserDefModal,
    isOpen: () => userDefModal.classList.contains('visible'),
    getGroup: () => ({
      kind: userDefKindSelect?.value || 'section',
      target: userDefTargetSelect?.value || 'member',
      type: userDefTypeSelect?.value || '',
    }),
    refreshMaterialSelectOptions,
    refreshUserDefEndSpringVisibility,
    applyLanguage() {
      applyI18nTo(userDefModal);
      refreshUserDefTypeOptions();
      refreshUserDefFormVisibility();
      clearUserDefFormError();
    },
  };
}
