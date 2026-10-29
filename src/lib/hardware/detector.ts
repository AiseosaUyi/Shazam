import os from 'os';

export type HardwareTier = 'tier_1_low' | 'tier_2_medium' | 'tier_3_high';

export interface RecommendedModel {
  modelId: string;
  name: string;
  parameterSize: string;
  quantization: string;
  ramRequirementGB: number;
  expectedSpeedTokensPerSec: string;
  description: string;
}

export interface HardwareProfile {
  tier: HardwareTier;
  ramGB: number;
  cpuCores: number;
  platform: string;
  arch: string;
  isAppleSilicon: boolean;
  acceleration: 'metal' | 'cuda' | 'cpu';
  recommendedModels: RecommendedModel[];
}

export function detectLocalHardware(): HardwareProfile {
  let ramBytes = 8 * 1024 * 1024 * 1024; // fallback 8GB
  let cpuCores = 4;
  let platform = 'darwin';
  let arch = 'arm64';

  try {
    ramBytes = os.totalmem();
    cpuCores = os.cpus().length;
    platform = os.platform();
    arch = os.arch();
  } catch {
    // browser or edge fallback
  }

  const ramGB = Math.round(ramBytes / (1024 * 1024 * 1024));
  const isAppleSilicon = platform === 'darwin' && (arch === 'arm64' || arch === 'aarch64');
  const acceleration = isAppleSilicon ? 'metal' : 'cpu';

  let tier: HardwareTier = 'tier_1_low';
  let recommendedModels: RecommendedModel[] = [];

  if (ramGB >= 32) {
    tier = 'tier_3_high';
    recommendedModels = [
      {
        modelId: 'qwen2.5-coder:14b',
        name: 'Qwen 2.5 Coder 14B',
        parameterSize: '14B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 9.2,
        expectedSpeedTokensPerSec: isAppleSilicon ? '35-50 t/s' : '15-25 t/s',
        description: 'Elite coding & refactoring benchmark. Excels at multi-file repository maintenance and complex logic.',
      },
      {
        modelId: 'deepseek-r1:14b',
        name: 'DeepSeek R1 14B (Reasoning)',
        parameterSize: '14B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 9.5,
        expectedSpeedTokensPerSec: isAppleSilicon ? '30-45 t/s' : '12-20 t/s',
        description: 'Deep mathematical & algorithmic chain-of-thought reasoning directly on local unified memory.',
      },
      {
        modelId: 'qwen2.5:32b',
        name: 'Qwen 2.5 32B (Dense)',
        parameterSize: '32B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 20.5,
        expectedSpeedTokensPerSec: isAppleSilicon ? '20-30 t/s' : '8-15 t/s',
        description: 'Frontier-tier local general intelligence with 128k context support.',
      },
    ];
  } else if (ramGB >= 14) {
    tier = 'tier_2_medium';
    recommendedModels = [
      {
        modelId: 'qwen2.5-coder:7b',
        name: 'Qwen 2.5 Coder 7B',
        parameterSize: '7B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 4.8,
        expectedSpeedTokensPerSec: isAppleSilicon ? '55-80 t/s' : '20-35 t/s',
        description: 'Fast, high-fidelity coding assistant. Perfect sweet spot for 16GB developer machines.',
      },
      {
        modelId: 'llama3.2:3b',
        name: 'Llama 3.2 3B',
        parameterSize: '3B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 2.2,
        expectedSpeedTokensPerSec: '80-120 t/s',
        description: 'Ultra-responsive conversational model with minimal footprint.',
      },
      {
        modelId: 'deepseek-r1:8b',
        name: 'DeepSeek R1 8B (Reasoning)',
        parameterSize: '8B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 5.4,
        expectedSpeedTokensPerSec: isAppleSilicon ? '45-65 t/s' : '15-25 t/s',
        description: 'Distilled reasoning model based on Llama-3.1-8B.',
      },
    ];
  } else {
    tier = 'tier_1_low';
    recommendedModels = [
      {
        modelId: 'qwen2.5-coder:1.5b',
        name: 'Qwen 2.5 Coder 1.5B',
        parameterSize: '1.5B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 1.2,
        expectedSpeedTokensPerSec: '90-150 t/s',
        description: 'Sub-2GB coding model designed for low-memory devices. Fast inline completions.',
      },
      {
        modelId: 'deepseek-r1:1.5b',
        name: 'DeepSeek R1 1.5B',
        parameterSize: '1.5B',
        quantization: 'Q4_K_M',
        ramRequirementGB: 1.4,
        expectedSpeedTokensPerSec: '85-130 t/s',
        description: 'Lightweight distilled reasoning engine with zero memory swap risk.',
      },
    ];
  }

  return {
    tier,
    ramGB,
    cpuCores,
    platform,
    arch,
    isAppleSilicon,
    acceleration,
    recommendedModels,
  };
}
