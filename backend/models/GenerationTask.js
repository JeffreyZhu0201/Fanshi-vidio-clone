import { DataTypes } from 'sequelize';

import { TASK_STATUS, TASK_STATUS_VALUES } from '../config/constants.js';

const defineGenerationTaskModel = (sequelize) => {
  const GenerationTask = sequelize.define(
    'GenerationTask',
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
      }
    },
    {
      tableName: 'generation_tasks',
      indexes: [
        {
          name: 'generation_tasks_segment_id_idx',
          fields: ['segment_id']
        },
        {
          name: 'generation_tasks_status_idx',
          fields: ['status']
        }
      ]
    }
  );

  GenerationTask.associate = ({ Segment }) => {
    if (Segment) {
      GenerationTask.belongsTo(Segment, {
        foreignKey: 'segmentId',
        as: 'segment',
        onDelete: 'CASCADE'
      });
    }
  };

  return GenerationTask;
};

export default defineGenerationTaskModel;
