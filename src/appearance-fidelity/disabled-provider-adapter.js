const DISABLED_ERROR_CODE = 'PROVIDER_ADAPTER_DISABLED';

function disabledError(operation) {
  const error = new Error(`appearance fidelity provider adapter is disabled: ${operation}`);
  error.code = DISABLED_ERROR_CODE;
  return error;
}

export function createDisabledProviderAdapter() {
  return Object.freeze({
    provider: 'hifly',
    kind: 'disabled',
    mode: 'fail_closed',
    enabled: false,
    async generateCandidate() {
      throw disabledError('generateCandidate');
    },
    async observeReference() {
      throw disabledError('observeReference');
    },
  });
}

export const disabledProviderAdapter = createDisabledProviderAdapter();

export default disabledProviderAdapter;
