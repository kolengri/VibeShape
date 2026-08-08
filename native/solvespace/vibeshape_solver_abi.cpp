#include <cmath>
#include <cstdint>
#include <limits>
#include <unordered_set>
#include <vector>

#include <emscripten/bind.h>
#include <emscripten/heap.h>
#include <emscripten/val.h>

#include "slvs.h"

namespace {

using emscripten::val;

constexpr std::size_t PARAMETER_METADATA_STRIDE = 2;
constexpr std::size_t ENTITY_RECORD_STRIDE = 14;
constexpr std::size_t CONSTRAINT_RECORD_STRIDE = 12;
constexpr std::size_t MAX_PARAMETER_COUNT = 10000;
constexpr std::size_t MAX_ENTITY_COUNT = 5000;
constexpr std::size_t MAX_CONSTRAINT_COUNT = 10000;

enum class AbiStatus : int {
    OKAY = 0,
    INVALID_LAYOUT = -1,
    LIMIT_EXCEEDED = -2,
    NON_FINITE_VALUE = -3,
    INVALID_REFERENCE = -4,
    INVALID_HANDLE = -5,
    UNSUPPORTED_TYPE = -6,
};

struct FlatSolveResult {
    int abiStatus;
    int solverStatus;
    int degreesOfFreedom;
    double maximumResidual;
    val parameterValues;
    val failedConstraints;
};

template <typename T>
std::vector<T> CopyTypedArray(const val &input) {
    const std::size_t length = input["length"].as<std::size_t>();
    std::vector<T> result(length);

    if (!result.empty()) {
        val view = val(emscripten::typed_memory_view(result.size(), result.data()));
        view.call<void>("set", input);
    }

    return result;
}

template <typename T>
val ToTypedArray(const char *constructorName, const std::vector<T> &source) {
    val result = val::global(constructorName).new_(source.size());

    if (!source.empty()) {
        result.call<void>("set", val(emscripten::typed_memory_view(source.size(), source.data())));
    }

    return result;
}

FlatSolveResult EmptyResult(AbiStatus status) {
    return {
        static_cast<int>(status),
        -1,
        -1,
        std::numeric_limits<double>::quiet_NaN(),
        val::global("Float64Array").new_(0),
        val::global("Uint32Array").new_(0),
    };
}

bool IsFinite(const std::vector<double> &values) {
    for (double value : values) {
        if (!std::isfinite(value)) {
            return false;
        }
    }

    return true;
}

bool IsSupportedEntityType(std::uint32_t type) {
    switch (type) {
        case SLVS_E_POINT_IN_3D:
        case SLVS_E_POINT_IN_2D:
        case SLVS_E_NORMAL_IN_3D:
        case SLVS_E_NORMAL_IN_2D:
        case SLVS_E_DISTANCE:
        case SLVS_E_WORKPLANE:
        case SLVS_E_LINE_SEGMENT:
        case SLVS_E_CUBIC:
        case SLVS_E_CIRCLE:
        case SLVS_E_ARC_OF_CIRCLE:
            return true;
        default:
            return false;
    }
}

bool ContainsReference(const std::unordered_set<std::uint32_t> &handles, std::uint32_t handle) {
    return handle == 0 || handles.find(handle) != handles.end();
}

AbiStatus ValidateRecords(
    const std::vector<std::uint32_t> &parameterMetadata,
    const std::vector<std::uint32_t> &entityRecords,
    const std::vector<std::uint32_t> &constraintRecords,
    const std::vector<std::uint32_t> &draggedParameters
) {
    std::unordered_set<std::uint32_t> parameterHandles;
    for (std::size_t offset = 0; offset < parameterMetadata.size(); offset += PARAMETER_METADATA_STRIDE) {
        const std::uint32_t handle = parameterMetadata[offset];
        const std::uint32_t group = parameterMetadata[offset + 1];
        if (handle == 0 || group == 0 || !parameterHandles.insert(handle).second) {
            return AbiStatus::INVALID_HANDLE;
        }
    }

    std::unordered_set<std::uint32_t> entityHandles;
    for (std::size_t offset = 0; offset < entityRecords.size(); offset += ENTITY_RECORD_STRIDE) {
        const std::uint32_t handle = entityRecords[offset];
        const std::uint32_t group = entityRecords[offset + 1];
        if (handle == 0 || group == 0 || !entityHandles.insert(handle).second) {
            return AbiStatus::INVALID_HANDLE;
        }
        if (!IsSupportedEntityType(entityRecords[offset + 2])) {
            return AbiStatus::UNSUPPORTED_TYPE;
        }
    }

    for (std::size_t offset = 0; offset < entityRecords.size(); offset += ENTITY_RECORD_STRIDE) {
        for (std::size_t reference = 3; reference <= 9; ++reference) {
            if (!ContainsReference(entityHandles, entityRecords[offset + reference])) {
                return AbiStatus::INVALID_REFERENCE;
            }
        }
        for (std::size_t parameter = 10; parameter <= 13; ++parameter) {
            if (!ContainsReference(parameterHandles, entityRecords[offset + parameter])) {
                return AbiStatus::INVALID_REFERENCE;
            }
        }
    }

    std::unordered_set<std::uint32_t> constraintHandles;
    for (std::size_t offset = 0; offset < constraintRecords.size(); offset += CONSTRAINT_RECORD_STRIDE) {
        const std::uint32_t handle = constraintRecords[offset];
        const std::uint32_t group = constraintRecords[offset + 1];
        const std::uint32_t type = constraintRecords[offset + 2];
        if (handle == 0 || group == 0 || !constraintHandles.insert(handle).second) {
            return AbiStatus::INVALID_HANDLE;
        }
        if (type < SLVS_C_POINTS_COINCIDENT || type > SLVS_C_ARC_LINE_DIFFERENCE) {
            return AbiStatus::UNSUPPORTED_TYPE;
        }
        if (!ContainsReference(entityHandles, constraintRecords[offset + 3])) {
            return AbiStatus::INVALID_REFERENCE;
        }
        for (std::size_t reference = 4; reference <= 9; ++reference) {
            if (!ContainsReference(entityHandles, constraintRecords[offset + reference])) {
                return AbiStatus::INVALID_REFERENCE;
            }
        }
    }

    for (std::uint32_t handle : draggedParameters) {
        if (parameterHandles.find(handle) == parameterHandles.end()) {
            return AbiStatus::INVALID_REFERENCE;
        }
    }

    return AbiStatus::OKAY;
}

FlatSolveResult SolveFlatSystem(
    const val &parameterMetadataInput,
    const val &parameterValuesInput,
    const val &entityRecordsInput,
    const val &constraintRecordsInput,
    const val &constraintValuesInput,
    const val &draggedParametersInput,
    std::uint32_t solveGroup,
    bool calculateFailedConstraints
) {
    const std::vector<std::uint32_t> parameterMetadata =
        CopyTypedArray<std::uint32_t>(parameterMetadataInput);
    const std::vector<double> parameterValues = CopyTypedArray<double>(parameterValuesInput);
    const std::vector<std::uint32_t> entityRecords =
        CopyTypedArray<std::uint32_t>(entityRecordsInput);
    const std::vector<std::uint32_t> constraintRecords =
        CopyTypedArray<std::uint32_t>(constraintRecordsInput);
    const std::vector<double> constraintValues = CopyTypedArray<double>(constraintValuesInput);
    const std::vector<std::uint32_t> draggedParameters =
        CopyTypedArray<std::uint32_t>(draggedParametersInput);

    if (
        parameterMetadata.size() != parameterValues.size() * PARAMETER_METADATA_STRIDE ||
        entityRecords.size() % ENTITY_RECORD_STRIDE != 0 ||
        constraintRecords.size() != constraintValues.size() * CONSTRAINT_RECORD_STRIDE ||
        solveGroup == 0
    ) {
        return EmptyResult(AbiStatus::INVALID_LAYOUT);
    }

    const std::size_t parameterCount = parameterValues.size();
    const std::size_t entityCount = entityRecords.size() / ENTITY_RECORD_STRIDE;
    const std::size_t constraintCount = constraintValues.size();

    if (
        parameterCount > MAX_PARAMETER_COUNT ||
        entityCount > MAX_ENTITY_COUNT ||
        constraintCount > MAX_CONSTRAINT_COUNT ||
        draggedParameters.size() > parameterCount
    ) {
        return EmptyResult(AbiStatus::LIMIT_EXCEEDED);
    }

    if (!IsFinite(parameterValues) || !IsFinite(constraintValues)) {
        return EmptyResult(AbiStatus::NON_FINITE_VALUE);
    }

    const AbiStatus recordStatus = ValidateRecords(
        parameterMetadata,
        entityRecords,
        constraintRecords,
        draggedParameters
    );
    if (recordStatus != AbiStatus::OKAY) {
        return EmptyResult(recordStatus);
    }

    std::vector<Slvs_Param> parameters(parameterCount);
    for (std::size_t index = 0; index < parameterCount; ++index) {
        const std::size_t offset = index * PARAMETER_METADATA_STRIDE;
        parameters[index] = Slvs_MakeParam(
            parameterMetadata[offset],
            parameterMetadata[offset + 1],
            parameterValues[index]
        );
    }

    std::vector<Slvs_Entity> entities(entityCount);
    for (std::size_t index = 0; index < entityCount; ++index) {
        const std::size_t offset = index * ENTITY_RECORD_STRIDE;
        Slvs_Entity entity = {};
        entity.h = entityRecords[offset];
        entity.group = entityRecords[offset + 1];
        entity.type = static_cast<int>(entityRecords[offset + 2]);
        entity.wrkpl = entityRecords[offset + 3];
        for (std::size_t point = 0; point < 4; ++point) {
            entity.point[point] = entityRecords[offset + 4 + point];
        }
        entity.normal = entityRecords[offset + 8];
        entity.distance = entityRecords[offset + 9];
        for (std::size_t parameter = 0; parameter < 4; ++parameter) {
            entity.param[parameter] = entityRecords[offset + 10 + parameter];
        }
        entities[index] = entity;
    }

    std::vector<Slvs_Constraint> constraints(constraintCount);
    for (std::size_t index = 0; index < constraintCount; ++index) {
        const std::size_t offset = index * CONSTRAINT_RECORD_STRIDE;
        Slvs_Constraint constraint = {};
        constraint.h = constraintRecords[offset];
        constraint.group = constraintRecords[offset + 1];
        constraint.type = static_cast<int>(constraintRecords[offset + 2]);
        constraint.wrkpl = constraintRecords[offset + 3];
        constraint.valA = constraintValues[index];
        constraint.ptA = constraintRecords[offset + 4];
        constraint.ptB = constraintRecords[offset + 5];
        constraint.entityA = constraintRecords[offset + 6];
        constraint.entityB = constraintRecords[offset + 7];
        constraint.entityC = constraintRecords[offset + 8];
        constraint.entityD = constraintRecords[offset + 9];
        constraint.other = static_cast<int>(constraintRecords[offset + 10]);
        constraint.other2 = static_cast<int>(constraintRecords[offset + 11]);
        constraints[index] = constraint;
    }

    std::vector<Slvs_hConstraint> failedConstraints(constraintCount);
    Slvs_System system = {};
    system.param = parameters.data();
    system.params = static_cast<int>(parameters.size());
    system.entity = entities.data();
    system.entities = static_cast<int>(entities.size());
    system.constraint = constraints.data();
    system.constraints = static_cast<int>(constraints.size());
    system.dragged = const_cast<Slvs_hParam *>(draggedParameters.data());
    system.ndragged = static_cast<int>(draggedParameters.size());
    system.calculateFaileds = calculateFailedConstraints ? 1 : 0;
    system.failed = failedConstraints.data();
    system.faileds = static_cast<int>(failedConstraints.size());

    Slvs_Solve(&system, solveGroup);

    std::vector<double> solvedValues(parameters.size());
    for (std::size_t index = 0; index < parameters.size(); ++index) {
        solvedValues[index] = parameters[index].val;
    }
    failedConstraints.resize(static_cast<std::size_t>(system.faileds));

    return {
        static_cast<int>(AbiStatus::OKAY),
        system.result,
        system.dof,
        Slvs_MaximumResidual(),
        ToTypedArray("Float64Array", solvedValues),
        ToTypedArray("Uint32Array", failedConstraints),
    };
}

std::size_t GetHeapCapacityBytes() {
    return emscripten_get_heap_size();
}

} // namespace

EMSCRIPTEN_BINDINGS(vibeshape_sketch_solver) {
    emscripten::constant("PARAMETER_METADATA_STRIDE", PARAMETER_METADATA_STRIDE);
    emscripten::constant("ENTITY_RECORD_STRIDE", ENTITY_RECORD_STRIDE);
    emscripten::constant("CONSTRAINT_RECORD_STRIDE", CONSTRAINT_RECORD_STRIDE);

    emscripten::value_object<FlatSolveResult>("FlatSolveResult")
        .field("abiStatus", &FlatSolveResult::abiStatus)
        .field("solverStatus", &FlatSolveResult::solverStatus)
        .field("degreesOfFreedom", &FlatSolveResult::degreesOfFreedom)
        .field("maximumResidual", &FlatSolveResult::maximumResidual)
        .field("parameterValues", &FlatSolveResult::parameterValues)
        .field("failedConstraints", &FlatSolveResult::failedConstraints);

    emscripten::function("solveFlatSystem", &SolveFlatSystem);
    emscripten::function("getHeapCapacityBytes", &GetHeapCapacityBytes);
}
