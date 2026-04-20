import { DataTypes } from 'sequelize';

import { TASK_STATUS, TASK_STATUS_VALUES } from '../config/constants.js';

const defineShotGenerationTaskModel = (sequelize) => {
  const ShotGenerationTask = sequelize.define(
    'ShotGenerationTask',
    {
      id: {
        type: DataTypes.INTEGER.UNSIGNED,
        autoIncrement: true,
        primaryKey: true
      },
      segmentId: {
        field: 'segment_id',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        references: {
          model: 'segments',
          key: 'id'
        }
      },
      shotId: {
        field: 'shot_id',
        type: DataTypes.STRING(191),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      shotIndex: {
        field: 'shot_index',
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0
      },
      prompt: {
        type: DataTypes.TEXT('long'),
        allowNull: false,
        validate: {
          notEmpty: true
        }
      },
      optimizedPrompt: {
        field: 'optimized_prompt',
        type: DataTypes.TEXT('long'),
        allowNull: true
      },
      startTime: {
        field: 'start_time',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
      },
      endTime: {
        field: 'end_time',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
      },
      durationSeconds: {
        field: 'duration_seconds',
        type: DataTypes.DECIMAL(10, 2),
        allowNull: true
      },
      status: {
        type: DataTypes.ENUM(...TASK_STATUS_VALUES),
        allowNull: false,
        defaultValue: TASK_STATUS.pending
      },
      resultUrl: {
        field: 'result_url',
        type: DataTypes.STRING(500),
        allowNull: true,
        validate: {
          len: [0, 500]
        }
      },
      progress: {
        type: DataTypes.INTEGER.UNSIGNED,
        allowNull: false,
        defaultValue: 0,
        validate: {
          min: 0,
          max: 100
        }
      },
      errorMessage: {
        field: 'error_message',
        type: DataTypes.TEXT,
        allowNull: true
      },
      meta: {
        type: DataTypes.JSON,
        allowNull: true
      }
    },
    {
      tableName: 'shot_generation_tasks',
      indexes: [
        {
          name: 'shot_generation_tasks_segment_id_idx',
          fields: ['segment_id']
        },
        {
          name: 'shot_generation_tasks_status_idx',
          fields: ['status']
        },
        {
          name: 'shot_generation_tasks_segment_shot_idx',
          fields: ['segment_id', 'shot_id']
        }
      ]
    }
  );

  ShotGenerationTask.associate = ({ Segment }) => {
    if (Segment) {
      ShotGenerationTask.belongsTo(Segment, {
        foreignKey: 'segmentId',
        as: 'segment',
        onDelete: 'CASCADE'
      });
    }
  };

  return ShotGenerationTask;
};

export default defineShotGenerationTaskModel;
