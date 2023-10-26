const canvas = document.querySelector('canvas');

const GRID_SIZE = 32;
const UPDATE_INTERVAL = 200; // 5 times per second
const WORKGROUP_SIZE = 8;
const WORKGROUP_COUNT = Math.ceil(GRID_SIZE / WORKGROUP_SIZE);
let step = 0; // Track simulation steps

function showError(message) {
  const errorMessageEl = document.createElement('div');
  errorMessageEl.classList = 'error-message';

  const container = document.createElement('div');
  container.textContent = `Error: ${message}`;
  container.classList = 'container';
  errorMessageEl.appendChild(container);

  console.error('Error: ', message);
  document.body.appendChild(errorMessageEl);
}

async function main() {
  if (!canvas) {
    return showError('Canvas element not found');
  }

  if (!navigator.gpu) {
    return showError('WebGPU not supported on this browser!');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return showError('Failed to find a suitable GPUAdapter device.');
  }

  const device = await adapter.requestDevice();
  if (!device) {
    return showError('Failed to create a WebGPU device.');
  }

  const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
  const context = canvas.getContext('webgpu');
  context.configure({
    device,
    format: canvasFormat,
  });

  // Define vertices
  // prettier-ignore
  const vertices = new Float32Array([
    // X,   Y
    -0.8, -0.8, // first triangle
     0.8, -0.8,
     0.8,  0.8,

    -0.8, -0.8, // second triangle
    -0.8,  0.8,
     0.8,  0.8,
  ]);

  // Create vertex buffer
  const vertexBuffer = device.createBuffer({
    label: 'Cell vertices',
    size: vertices.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });

  // Copy vertex data to buffer's memory
  device.queue.writeBuffer(vertexBuffer, /*bufferOffset=0*/ 0, vertices);

  // Define vertex data structure
  const vertexBufferLayout = {
    arrayStride: 4 * 2,
    attributes: [
      {
        format: 'float32x2',
        shaderLocation: 0, // Position, see vertex shader
        offset: 0,
      },
    ],
  };

  const wgslCode = /* wgsl */ `
struct VertexInput {
  @location(0) pos : vec2f,
  @builtin(instance_index) instance : u32,
}

struct VertexOutput {
  @builtin(position) pos : vec4f,
  @location(0) cell : vec2f,
}

@group(0) @binding(0) var<uniform> grid : vec2f;
@group(0) @binding(1) var<storage> cellState: array<u32>;

@vertex
fn vertexMain(input : VertexInput) -> VertexOutput {

  let index = f32(input.instance);
  let cell = vec2f(index % grid.x, floor(index / grid.x));
  let state = f32(cellState[input.instance]);

  let cellOffset = cell / grid * 2;
  let scaledPos = input.pos * state + 1;
  let gridPos = scaledPos / grid - 1 + cellOffset;

  var output : VertexOutput;
  output.pos = vec4f(gridPos, 0, 1);
  output.cell = cell;

  return output;
}

@fragment
fn fragmentMain(input : VertexOutput) -> @location(0) vec4f {
  let channel = input.cell / grid;
  let blue = 1 - channel.x;

  return vec4f(channel, blue, 1);
}
`;

  // Create shader module
  const cellShaderModule = device.createShaderModule({
    label: 'Cell Shader',
    code: wgslCode,
  });

  // Compute shader to process the simulation
  const simulationShaderModule = device.createShaderModule({
    label: 'Simulation Shader',
    code: /* wgsl */ `
@group(0) @binding(0) var<uniform> grid: vec2f;

@group(0) @binding(1) var<storage> cellStateIn: array<u32>;
@group(0) @binding(2) var<storage, read_write> cellStateOut: array<u32>;

fn cellIndex(cell: vec2u) -> u32 {
  return (cell.y % u32(grid.y)) * u32(grid.x) + (cell.x % u32(grid.x));
}

fn cellActive(x: u32, y: u32) -> u32 {
  return cellStateIn[cellIndex(vec2(x, y))];
}

@compute @workgroup_size(${WORKGROUP_SIZE}, ${WORKGROUP_SIZE})
fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
  let activeNeighbors = cellActive(cell.x + 1, cell.y + 1) +
                        cellActive(cell.x + 1, cell.y) +
                        cellActive(cell.x + 1, cell.y - 1) +
                        cellActive(cell.x, cell.y - 1) +
                        cellActive(cell.x - 1, cell.y - 1) +
                        cellActive(cell.x - 1, cell.y) +
                        cellActive(cell.x - 1, cell.y + 1) +
                        cellActive(cell.x, cell.y + 1);
  
  let index = cellIndex(cell.xy);

  switch activeNeighbors {
    case 2: {
      cellStateOut[index] = cellStateIn[index];
    }
    case 3: {
      cellStateOut[index] = 1;
    }
    default: {
      cellStateOut[index] = 0;
    }
  }
}
`,
  });

  // Create bind group layout
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'Cell Bind Group Layout',
    entries: [
      {
        binding: 0,
        visibility:
          GPUShaderStage.VERTEX |
          GPUShaderStage.FRAGMENT |
          GPUShaderStage.COMPUTE,
        buffer: {},
      },
      {
        binding: 1,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
        buffer: { type: 'read-only-storage' },
      },
      {
        binding: 2,
        visibility: GPUShaderStage.COMPUTE,
        buffer: { type: 'storage' },
      },
    ],
  });

  // Create pipeline layout
  const pipelineLayout = device.createPipelineLayout({
    label: 'Cell Compute Pipeline Layout',
    bindGroupLayouts: [bindGroupLayout],
  });

  // Create a compute pipeline to update game state
  const simulationPipeline = device.createComputePipeline({
    label: 'Simulation Compute Pipeline',
    layout: pipelineLayout,
    compute: {
      module: simulationShaderModule,
      entryPoint: 'computeMain',
    },
  });

  // Cell render pipeline
  const cellPipeline = device.createRenderPipeline({
    label: 'Cell pipeline',
    layout: pipelineLayout,
    vertex: {
      module: cellShaderModule,
      entryPoint: 'vertexMain',
      buffers: [vertexBufferLayout],
    },
    fragment: {
      module: cellShaderModule,
      entryPoint: 'fragmentMain',
      targets: [{ format: canvasFormat }],
    },
  });

  // Create a uniform buffer that describe the grid
  const uniformArray = new Float32Array([GRID_SIZE, GRID_SIZE]);
  const uniformBuffer = device.createBuffer({
    label: 'Grid Uniform',
    size: uniformArray.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  // Copy data to the uniform buffer
  device.queue.writeBuffer(uniformBuffer, 0, uniformArray);

  // Create cell state storage buffer
  const cellStateArray = new Uint32Array(GRID_SIZE * GRID_SIZE);

  const cellStateStorageBuffer = [
    device.createBuffer({
      label: 'Cell State Storage Buffer A',
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
    device.createBuffer({
      label: 'Cell State Storage Buffer B',
      size: cellStateArray.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    }),
  ];

  for (let i = 0; i < cellStateArray.length; i += 3) {
    cellStateArray[i] = Math.random() > 0.6 ? 1 : 0;
  }
  device.queue.writeBuffer(cellStateStorageBuffer[0], 0, cellStateArray);

  for (let i = 0; i < cellStateArray.length; i++) {
    cellStateArray[i] = i % 2;
  }
  device.queue.writeBuffer(cellStateStorageBuffer[1], 0, cellStateArray);

  // Create a bind group with uniform buffer
  const uniformBindGroups = [
    device.createBindGroup({
      label: 'Cell Uniform Bind Group A',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: cellStateStorageBuffer[0] } },
        { binding: 2, resource: { buffer: cellStateStorageBuffer[1] } },
      ],
    }),
    device.createBindGroup({
      label: 'Cell Uniform Bind Group B',
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: cellStateStorageBuffer[1] } },
        { binding: 2, resource: { buffer: cellStateStorageBuffer[0] } },
      ],
    }),
  ];

  const updateGrid = () => {
    const encoder = device.createCommandEncoder();
    const computePass = encoder.beginComputePass();

    computePass.setPipeline(simulationPipeline);
    computePass.setBindGroup(0, uniformBindGroups[step % 2]);
    computePass.dispatchWorkgroups(WORKGROUP_COUNT, WORKGROUP_COUNT);

    computePass.end();
    step += 1;

    const textureView = context.getCurrentTexture().createView();
    const renderPassDescriptor = {
      colorAttachments: [
        {
          view: textureView,
          clearValue: { r: 0, g: 0, b: 0, a: 1.0 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    };

    const passEncoder = encoder.beginRenderPass(renderPassDescriptor);

    passEncoder.setPipeline(cellPipeline);
    passEncoder.setVertexBuffer(0, vertexBuffer);

    passEncoder.setBindGroup(0, uniformBindGroups[step % 2]);
    passEncoder.draw(vertices.length / 2, GRID_SIZE * GRID_SIZE);
    passEncoder.end();

    const commandBuffer = encoder.finish();
    device.queue.submit([commandBuffer]);
  };

  setInterval(updateGrid, UPDATE_INTERVAL);
}

try {
  await main();
} catch (error) {
  showError(error);
}
