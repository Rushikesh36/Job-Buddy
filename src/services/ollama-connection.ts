export interface OllamaStatus {
  connected: boolean;
  models: string[];
  message: string;
}

export async function checkOllamaConnection(baseUrl: string): Promise<OllamaStatus> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(3000)
    });
    
    if (response.ok) {
      const data = await response.json();
      const models = data.models?.map((m: any) => m.name) || [];
      return {
        connected: true,
        models,
        message: `Connected (${models.length} models available)`
      };
    }
    return { connected: false, models: [], message: 'Ollama responded but returned an error' };
  } catch (error) {
    return { connected: false, models: [], message: 'Ollama is not running' };
  }
}

export async function getOllamaModels(baseUrl: string): Promise<string[]> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/api/tags`;
    const response = await fetch(url, { signal: AbortSignal.timeout(3000) });
    const data = await response.json();
    return data.models?.map((m: any) => m.name) || [];
  } catch {
    return ['qwen2.5:14b', 'gemma4:e4b'];
  }
}
